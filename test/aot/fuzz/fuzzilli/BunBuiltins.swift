// Bun's and Node's APIs for BunCompilerProfile.swift, read from the file that list-builtins.ts writes.

import Foundation

struct BunParameter: Decodable {
    let type: [String]
    let isOptional: Bool
    let isCallback: Bool
    /// The properties that Bun reads from this argument.
    let members: [String]
    /// The paths of the functions in this argument that Bun calls, like ["socket", "data"].
    let handlers: [[String]]
}

struct BunSignature: Decodable {
    let parameters: [BunParameter]
    let result: [String]
}

struct BunCall: Decodable {
    let root: String
    let path: [String]
    let constructs: Bool
    let parameters: [BunParameter]
    let result: [String]
}

struct BunRoot: Decodable {
    let group: String?
    let constructs: Bool?
    let parameters: [BunParameter]?
    let result: [String]?
}

struct BunGroup: Decodable {
    let name: String
    let properties: [String: [String]]
    let methods: [String: BunSignature]
}

struct BunBuiltins: Decodable {
    var roots: [String: BunRoot] = [:]
    var groups: [BunGroup] = []
    var calls: [BunCall] = []

    static let shared: BunBuiltins = {
        guard let path = ProcessInfo.processInfo.environment["BUN_FUZZILLI_BUILTINS"] else { return BunBuiltins() }
        let data = try! Data(contentsOf: URL(fileURLWithPath: path))
        return try! JSONDecoder().decode(BunBuiltins.self, from: data)
    }()

    private static let instanceTypes: [String: ILType] = Dictionary(
        uniqueKeysWithValues: shared.groups.map { group in
            (
                group.name,
                ILType.object(
                    ofGroup: "Bun" + group.name, withProperties: Array(group.properties.keys),
                    withMethods: Array(group.methods.keys))
            )
        })

    static func type(_ names: [String]) -> ILType {
        var type = ILType.nothing
        for name in names {
            switch name {
            case "anything": return .jsAnything
            case "number": type |= .number
            case "integer": type |= .integer
            case "string": type |= .string
            case "boolean": type |= .boolean
            case "bigint": type |= .bigint
            case "undefined": type |= .undefined
            case "function": type |= .function()
            case "array": type |= .jsArray
            case "promise": type |= .jsPromise()
            case "uint8array": type |= .jsTypedArray("Uint8Array")
            case "arraybuffer": type |= .jsArrayBuffer
            case "map": type |= .jsMap
            case "set": type |= .jsSet
            case "date": type |= .jsDate
            case "regexp": type |= .jsRegExp
            case _ where name.hasPrefix("group:"): type |= instanceTypes[String(name.dropFirst(6))] ?? .object()
            case _ where name.hasPrefix("enum:"): type |= .string
            default: type |= .object()
            }
        }
        return type == .nothing ? .jsAnything : type
    }

    static func signature(_ parameters: [BunParameter], _ result: [String]) -> Signature {
        var isOptional = false
        let list: [Parameter] = parameters.map { parameter in
            isOptional = isOptional || parameter.isOptional
            return isOptional ? .opt(type(parameter.type)) : .plain(type(parameter.type))
        }
        return list => type(result)
    }

    static let objectGroups: [ObjectGroup] = shared.groups.map { group in
        ObjectGroup(
            name: "Bun" + group.name, instanceType: instanceTypes[group.name]!,
            properties: group.properties.mapValues(type),
            overloads: group.methods.mapValues { [signature($0.parameters, $0.result)] })
    }

    static let builtins: [String: ILType] = shared.roots.mapValues { root in
        if let group = root.group { return instanceTypes[group] ?? .object() }
        let signature = signature(root.parameters ?? [], root.result ?? ["anything"])
        return root.constructs == true ? .constructor(signature) : .function(signature)
    }

    static let constructors = shared.calls.filter { $0.constructs }
    static let callsWithHandlers = shared.calls.filter { call in
        call.parameters.contains { $0.isCallback || !$0.handlers.isEmpty || !$0.members.isEmpty }
    }
}

extension ProgramBuilder {
    fileprivate func load(_ call: BunCall) -> Variable {
        var value = createNamedVariable(forBuiltin: call.root)
        for name in call.path { value = getProperty(name, of: value) }
        return value
    }

    /// A function that prints `this` and its arguments, stores through `this`, and runs some generated code.
    fileprivate func fillHandler(named name: String, _ arguments: [Variable]) {
        let print = createNamedVariable(forBuiltin: "printValue")
        let this = loadThis()
        callFunction(print, withArgs: [loadString(name + " this"), this])
        for argument in arguments.prefix(2) { callFunction(print, withArgs: [loadString(name), argument]) }
        if probability(0.5) { setProperty(randomCustomPropertyName(), of: this, to: randomJsVariable(), guard: true) }
        // The generated code can hold calls with handlers of their own.
        let depth = Thread.current.threadDictionary["BunHandlerDepth"] as? Int ?? 0
        if depth < 2 {
            Thread.current.threadDictionary["BunHandlerDepth"] = depth + 1
            buildRecursive(n: 4)
            Thread.current.threadDictionary["BunHandlerDepth"] = depth
        }
        if probability(0.5) { doReturn(randomJsVariable()) }
    }

    /// Servers and sockets only listen on this machine, on a port that the system picks.
    fileprivate func fixedValue(ofMember name: String) -> Variable? {
        switch name {
        case "port": return loadInt(0)
        case "hostname", "host": return loadString("127.0.0.1")
        case "unix", "fd", "tls", "cwd", "env", "stdin", "stdout", "stderr", "idleTimeout": return loadUndefined()
        default: return nil
        }
    }

    /// An object with some of `members`. Each is a plain property, a getter or, where Bun calls it, a method.
    fileprivate func buildOptions(_ members: [String], _ handlers: [[String]], at prefix: [String] = []) -> Variable {
        let here = handlers.filter { $0.count > prefix.count && Array($0.prefix(prefix.count)) == prefix }
        let methods = Set(here.filter { $0.count == prefix.count + 1 }.map { $0[prefix.count] })
        let nested = Set(here.filter { $0.count > prefix.count + 1 }.map { $0[prefix.count] })
        var values: [(String, Variable)] = []
        for name in nested.sorted() { values.append((name, buildOptions([], handlers, at: prefix + [name]))) }
        for name in prefix.isEmpty ? members : [] where !methods.contains(name) && !nested.contains(name) {
            if let fixed = fixedValue(ofMember: name) {
                values.append((name, fixed))
            } else if probability(0.25) {
                values.append((name, randomJsVariable()))
            }
        }
        return buildObjectLiteral { object in
            for (name, value) in values {
                if probability(0.25) {
                    object.addGetter(for: name) { _ in self.doReturn(value) }
                } else {
                    object.addProperty(name, as: value)
                }
            }
            for name in methods.sorted() where probability(0.8) {
                object.addMethod(name, with: .parameters(n: 3)) { self.fillHandler(named: name, Array($0.dropFirst())) }
            }
        }
    }

    fileprivate func buildArguments(for call: BunCall) -> [Variable] {
        var arguments: [Variable] = []
        for parameter in call.parameters {
            if parameter.isOptional && probability(0.3) { break }
            if parameter.isCallback {
                let name = call.path.last ?? call.root
                arguments.append(buildPlainFunction(with: .parameters(n: 2)) { self.fillHandler(named: name, $0) })
            } else if !parameter.members.isEmpty || !parameter.handlers.isEmpty {
                arguments.append(buildOptions(parameter.members, parameter.handlers))
            } else if let literals = parameter.type.first(where: { $0.hasPrefix("enum:") }), probability(0.8) {
                arguments.append(loadString(chooseUniform(from: literals.dropFirst(5).split(separator: "|").map(String.init))))
            } else {
                arguments.append(findOrGenerateType(BunBuiltins.type(parameter.type)))
            }
        }
        return arguments
    }

    @discardableResult
    fileprivate func build(_ call: BunCall) -> Variable {
        let arguments = buildArguments(for: call)
        let function = load(call)
        if call.constructs { return construct(function, withArgs: arguments, guard: true) }
        guard let name = call.path.last else { return callFunction(function, withArgs: arguments, guard: true) }
        var holder = createNamedVariable(forBuiltin: call.root)
        for name in call.path.dropLast() { holder = getProperty(name, of: holder) }
        return callMethod(name, on: holder, withArgs: arguments, guard: true)
    }
}

/// BUN_FUZZILLI_BUILTINS_WEIGHT=<n> makes these generators n times as likely.
private let weight = Int(ProcessInfo.processInfo.environment["BUN_FUZZILLI_BUILTINS_WEIGHT"] ?? "") ?? 1

let bunCodeGenerators: [(CodeGenerator, Int)] = BunBuiltins.shared.calls.isEmpty ? [] : [
    (CodeGenerator("BunCallGenerator") { b in b.build(chooseUniform(from: BunBuiltins.shared.calls)) }, 30 * weight),

    (CodeGenerator("BunCallWithHandlersGenerator") { b in b.build(chooseUniform(from: BunBuiltins.callsWithHandlers)) }, 30 * weight),

    (CodeGenerator("BunSubclassGenerator") { b in
        let call = chooseUniform(from: BunBuiltins.constructors)
        let subclass = b.buildClassDefinition(withSuperclass: b.load(call)) { definition in
            definition.addInstanceProperty(b.randomCustomPropertyName(), value: b.randomJsVariable())
            definition.addInstanceMethod(b.randomCustomMethodName(), with: .parameters(n: 1)) {
                b.fillHandler(named: "method", Array($0.dropFirst()))
            }
        }
        b.construct(subclass, withArgs: b.buildArguments(for: call), guard: true)
    }, 10 * weight),

    (CodeGenerator("BunAwaitGenerator", inContext: .single(.async), inputs: .required(.jsPromise())) { b, promise in
        let print = b.createNamedVariable(forBuiltin: "printValue")
        b.callFunction(print, withArgs: [b.loadString("awaited"), b.await(promise)])
    }, 10 * weight),
]
