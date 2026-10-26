// Turns the JavaScript that Fuzzilli writes into TypeScript. README.md beside this file describes the settings.
//
// Fuzzilli's typer knows a type for every variable. A plan is made from it before a program is lifted: which
// declarations get an annotation and which one, which types are declared, and where a value has to pass through a
// cast so that the type checker accepts the program. `JavaScriptLifter` asks the plan while it writes
// (fuzzilli.patch). Removing the types from the result gives a program that prints the same.

import Foundation

// MARK: Settings

/// How often each choice is made. Every number is a weight among its neighbors or a probability in percent.
struct TypeScriptSettings {
    /// What a declaration says about its value.
    var absent = 15
    var right = 45
    var wider = 20
    var wrong = 20

    /// How the checker is made to accept what it can't be shown to accept.
    var uncheckedFile = 10
    var everyLineIgnored = 10
    var ignoredLine = 25

    /// How often a value takes a detour through generic code on its way into a declaration.
    var generic = 25
    /// How often an expression that could be written in place gets a declaration of its own.
    var declared = 50
    /// How often a whole number is an `int32`.
    var int32 = 10
    /// Added to what is computed from a program to seed its choices.
    var seed: UInt64 = 0

    static let fromEnvironment: TypeScriptSettings? = {
        guard let text = ProcessInfo.processInfo.environment["BUN_FUZZILLI_TYPES"], !text.isEmpty else { return nil }
        var settings = TypeScriptSettings()
        for part in text.split(separator: ",") {
            let pair = part.split(separator: "=", maxSplits: 1).map(String.init)
            guard pair.count == 2, let value = Int(pair[1]) else {
                switch pair[0] {
                case "mixed": break
                case "right": (settings.absent, settings.right, settings.wider, settings.wrong) = (0, 100, 0, 0)
                case "wider": (settings.absent, settings.right, settings.wider, settings.wrong) = (0, 0, 100, 0)
                case "wrong": (settings.absent, settings.right, settings.wider, settings.wrong) = (0, 0, 0, 100)
                case "absent": (settings.absent, settings.right, settings.wider, settings.wrong) = (100, 0, 0, 0)
                default: fatalError("BUN_FUZZILLI_TYPES: unknown setting \(part)")
                }
                continue
            }
            switch pair[0] {
            case "absent": settings.absent = value
            case "right": settings.right = value
            case "wider": settings.wider = value
            case "wrong": settings.wrong = value
            case "unchecked-file": settings.uncheckedFile = value
            case "every-line-ignored": settings.everyLineIgnored = value
            case "ignored-line": settings.ignoredLine = value
            case "generic": settings.generic = value
            case "declared": settings.declared = value
            case "int32": settings.int32 = value
            case "seed": settings.seed = UInt64(value)
            default: fatalError("BUN_FUZZILLI_TYPES: unknown setting \(part)")
            }
        }
        return settings
    }()
}

/// The same program always gets the same choices, so a finding can be reproduced and reduced.
private struct ChoiceGenerator {
    var state: UInt64

    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }

    mutating func below(_ bound: Int) -> Int { bound <= 1 ? 0 : Int(next() % UInt64(bound)) }
    mutating func percent(_ probability: Int) -> Bool { below(100) < probability }
    mutating func pick<T>(_ values: [T]) -> T { values[below(values.count)] }

    /// The index of one of the weights.
    mutating func weighted(_ weights: [Int]) -> Int {
        var rest = below(max(weights.reduce(0, +), 1))
        for (index, weight) in weights.enumerated() {
            if rest < weight { return index }
            rest -= weight
        }
        return 0
    }
}

// MARK: Types

/// What the checker takes an expression for, as far as the plan follows it.
indirect enum TypeScriptType: Hashable {
    case any, unknown
    /// The checker has a type for it that the plan doesn't follow. It can only be used through a cast.
    case untracked
    case number, int32, string, boolean, bigint, symbol, undefined, null, void, object
    /// An interface or a class.
    case named(String)
    case generic(String, [TypeScriptType])
    case array(TypeScriptType)
    case readonlyArray(TypeScriptType)
    case tuple([TypeScriptType])
    case union([TypeScriptType])
    case function([TypeScriptParameter], TypeScriptType)
    /// The constructor of a class of the program.
    case classOf(String)
    /// Another spelling of a type, such as `Same<O3>`.
    case alias(String, TypeScriptType)

    var text: String {
        switch self {
        case .any, .untracked: return "any"
        case .unknown: return "unknown"
        case .number: return "number"
        case .int32: return "int32"
        case .string: return "string"
        case .boolean: return "boolean"
        case .bigint: return "bigint"
        case .symbol: return "symbol"
        case .undefined: return "undefined"
        case .null: return "null"
        case .void: return "void"
        case .object: return "object"
        case .named(let name): return name
        case .generic(let name, let arguments): return "\(name)<\(arguments.map(\.text).joined(separator: ", "))>"
        case .array(let element): return "\(element.bracketed)[]"
        case .readonlyArray(let element): return "readonly \(element.bracketed)[]"
        case .tuple(let elements): return "[\(elements.map(\.text).joined(separator: ", "))]"
        case .union(let arms): return arms.map(\.bracketed).joined(separator: " | ")
        case .function(let parameters, let result):
            return "(\(parameters.map(\.text).joined(separator: ", "))) => \(result.text)"
        case .classOf(let name): return "typeof \(name)"
        case .alias(let text, _): return text
        }
    }

    /// The type without another spelling of it.
    var plain: TypeScriptType {
        if case .alias(_, let type) = self { return type.plain }
        return self
    }

    private var bracketed: String {
        switch self {
        case .union, .function, .readonlyArray, .classOf, .alias: return "(\(text))"
        default: return text
        }
    }

    var arms: [TypeScriptType] {
        if case .union(let arms) = self { return arms }
        return [self]
    }

    var isNumber: Bool { self == .number || self == .int32 }
    var isNullish: Bool { self == .undefined || self == .null || self == .void }

    static func union(of types: [TypeScriptType]) -> TypeScriptType {
        var arms = [TypeScriptType]()
        for arm in types.flatMap(\.arms) where !arms.contains(arm) {
            if arm == .any || arm == .untracked { return .any }
            arms.append(arm)
        }
        if arms.contains(.unknown) { return .unknown }
        return arms.count == 1 ? arms[0] : (arms.isEmpty ? .any : .union(arms))
    }

    var withoutNullish: TypeScriptType {
        let rest = arms.filter { !$0.isNullish }
        return rest.isEmpty ? self : .union(of: rest)
    }
}

struct TypeScriptParameter: Hashable {
    var name: String
    var type: TypeScriptType
    var isOptional = false
    var isRest = false

    var text: String { "\(isRest ? "..." : "")\(name)\(isOptional ? "?" : ""): \(type.text)" }
}

private struct Member {
    var type: TypeScriptType
    var isOptional = false
    var isReadonly = false
    var isMethod = false
}

private struct Callable {
    var parameters: [TypeScriptParameter]
    var result: TypeScriptType
    /// False where the plan didn't write every parameter's type, so the checker has a signature that the plan doesn't follow.
    var isTracked = true
    /// Which parameter has the type of the function's type parameter.
    var genericPosition: Int? = nil
    var isBounded = false
    var returnsTypeParameter = false
}

/// A value with brackets around it counts as an identifier where Fuzzilli wants one.
private let EffectfulBracketedExpression = ExpressionType(precedence: 20, characteristic: .effectful)

// MARK: The plan

final class TypeScriptPlan {
    private enum Conversion {
        case toAny
        case to(TypeScriptType)
        case throughUnknown(TypeScriptType)
        case nonNull
        case satisfies(TypeScriptType)
        case helper(String, TypeScriptType)
        case parsed(TypeScriptType)
        case replaced(String)
        case ignoredLine
    }

    private enum Acceptance { case casts, everyLineIgnored, uncheckedFile }

    private static let ignoredLineMarker = "/*ignored*/"

    private let settings: TypeScriptSettings
    private let code: Code
    private let environment: JavaScriptEnvironment
    private var choices: ChoiceGenerator
    private var acceptance = Acceptance.casts

    // What Fuzzilli's typer says.
    private var inferred = [Variable: ILType]()
    private var argumentTypes = [Int: [ILType]]()
    private var fewestArguments = [Int: Int]()
    private var resultTypes = [Int: ILType]()
    private var subroutineOfFunction = [Variable: Int]()
    private var constructorOfClass = [Variable: Int]()
    private var methodsOfClass = [Variable: [String: Int]]()
    private var classOfGroup = [String: Variable]()
    private var nameOfGroup = [String: String]()
    private var groupTypes = [String: ILType]()
    private var propertiesStoredLater = [String: [String: ILType]]()
    private var propertiesDeleted = [String: Set<String>]()
    private var fieldsOfClass = [Variable: Set<String>]()
    private var unknownNames = Set<Variable>()
    private var declarationsThatCannotBeStoredTo = Set<Variable>()
    private var ignoredHeads = Set<Int>()
    private var enumMembers = [String: String]()
    private var basesWithMembers = [String]()
    private var genericHeads = [Int: String]()
    private var reassigned = Set<Variable>()

    // What the checker is told.
    private var declared = [Variable: TypeScriptType]()
    private var literals = Set<Variable>()
    private var members = [String: [String: Member]]()
    private var baseOf = [String: String]()
    private var callables = [Variable: Callable]()
    private var constructors = [String: Callable]()
    private var methods = [String: [String: Callable]]()

    // What the lifter asks for.
    private var inputConversions = [Int: [Int: Conversion]]()
    private var outputConversions = [Variable: Conversion]()
    private var annotations = [Variable: TypeScriptType]()
    private var pinned = Set<Variable>()
    private var parameterAnnotations = [String: (type: TypeScriptType, isOptional: Bool)]()
    private var returnAnnotations = [Int: TypeScriptType]()
    private var fieldAnnotations = [Int: String]()
    private var helpers = Set<String>()
    private var usesInt32 = false
    private var interfaceOrder = [String]()

    static func make(for program: Program, in environment: JavaScriptEnvironment) -> TypeScriptPlan? {
        guard let settings = TypeScriptSettings.fromEnvironment else { return nil }
        for instr in program.code where instr.op is WasmOperation || instr.op is WasmTypeOperation || instr.op is BeginWith {
            return nil
        }
        return TypeScriptPlan(program.code, environment, settings)
    }

    private init(_ code: Code, _ environment: JavaScriptEnvironment, _ settings: TypeScriptSettings) {
        self.code = code
        self.environment = environment
        self.settings = settings
        var hash: UInt64 = 0xCBF2_9CE4_8422_2325 &+ settings.seed
        for instr in code {
            for byte in instr.op.name.utf8 { hash = (hash ^ UInt64(byte)) &* 0x100_0000_01B3 }
            for input in instr.inputs { hash = (hash ^ UInt64(input.number)) &* 0x100_0000_01B3 }
        }
        self.choices = ChoiceGenerator(state: hash)
        for instr in code {
            for v in instr.inputs where instr.reassigns(v) { reassigned.insert(v) }
            for v in instr.allOutputs { indexOfDefinition[v] = instr.index }
        }

        switch choices.weighted([
            100 - settings.uncheckedFile - settings.everyLineIgnored, settings.everyLineIgnored, settings.uncheckedFile,
        ]) {
        case 1: acceptance = code.contains(where: { $0.op is BeginCodeString }) ? .casts : .everyLineIgnored
        case 2: acceptance = .uncheckedFile
        default: acceptance = .casts
        }

        inferTypes(usingArguments: false)
        inferTypes(usingArguments: true)
        declareTypes()
        follow()
    }

    // MARK: What Fuzzilli's typer says

    /// Runs the typer over the program. The first run collects what each function is called with, and the second one
    /// tells the typer, so that it knows the parameters while it types the bodies.
    private func inferTypes(usingArguments: Bool) {
        var typer = JSTyper(for: environment)
        var subroutines = [Int]()
        var classes = [Variable]()
        var depth = 0
        var classesInBlocks = Set<Variable>()
        inferred.removeAll()

        func note(_ v: Variable) {
            let type = typer.type(of: v)
            inferred[v] = inferred[v].map { $0 | type } ?? type
        }
        func noteCall(of subroutine: Int?, with arguments: ArraySlice<Variable>) {
            guard !usingArguments, let subroutine else { return }
            var types = argumentTypes[subroutine] ?? []
            for (i, argument) in arguments.enumerated() {
                let type = typer.type(of: argument)
                if i < types.count { types[i] |= type } else { types.append(type) }
            }
            argumentTypes[subroutine] = types
            fewestArguments[subroutine] = min(fewestArguments[subroutine] ?? Int.max, arguments.count)
        }

        for instr in code {
            if usingArguments, let op = instr.op as? BeginAnySubroutine, let list = parameterList(of: op, at: instr.index) {
                typer.setParameters(forSubroutineStartingAt: instr.index, to: list)
            }
            typer.analyze(instr)
            if instr.isBlockEnd { depth -= 1 }
            defer { if instr.isBlockStart { depth += 1 } }
            for v in instr.allOutputs { note(v) }
            for v in instr.inputs where instr.reassigns(v) { note(v) }

            if instr.op is BeginAnySubroutine { subroutines.append(instr.index) }
            if instr.op is EndAnySubroutine, let begin = subroutines.popLast() {
                let head = code[begin]
                if head.op is BeginAnyFunction {
                    note(head.output)
                    resultTypes[begin] = typer.type(of: head.output).signature?.outputType
                }
            }

            switch instr.op.opcode {
            case .beginPlainFunction, .beginArrowFunction, .beginGeneratorFunction, .beginAsyncFunction,
                .beginAsyncArrowFunction, .beginAsyncGeneratorFunction:
                subroutineOfFunction[instr.output] = instr.index
                if instr.op is BeginAnyNamedFunction { declarationsThatCannotBeStoredTo.insert(instr.output) }
            case .beginClassDefinition:
                classes.append(instr.output)
                if depth > 0 { classesInBlocks.insert(instr.output) }
                declarationsThatCannotBeStoredTo.insert(instr.output)
            case .createNamedVariable(let op):
                if op.declarationMode == .none || op.declarationMode == .global, !environment.builtins.contains(op.variableName) {
                    unknownNames.insert(instr.output)
                }
            case .beginClassConstructor:
                if let current = classes.last { constructorOfClass[current] = instr.index }
            case .classAddProperty(let op):
                if let current = classes.last, !op.isStatic { fieldsOfClass[current, default: []].insert(op.propertyName) }
            case .beginClassMethod(let op):
                if let current = classes.last, !op.isStatic { methodsOfClass[current, default: [:]][op.methodName] = instr.index }
            case .endClassDefinition:
                guard let current = classes.popLast() else { break }
                note(current)
                if let instance = typer.type(of: current).constructorSignature?.outputType, let group = instance.group,
                    case .beginClassDefinition(let op) = definition(of: current)?.op.opcode, !op.isExpression,
                    !classesInBlocks.contains(current)
                {
                    classOfGroup[group] = current
                    nameOfGroup[group] = "C\(current.number)"
                    groupTypes[group] = instance
                    for (name, begin) in methodsOfClass[current] ?? [:] {
                        resultTypes[begin] = typer.inferMethodSignatures(of: name, on: instance).first?.outputType
                    }
                    memberTypes[group] = readMembers(of: instance, with: typer)
                }
            case .endObjectLiteral:
                let type = typer.type(of: instr.output)
                if let group = type.group, group.hasPrefix("_fuzz_Object") {
                    nameOfGroup[group] = "O\(instr.output.number)"
                    groupTypes[group] = type
                    memberTypes[group] = readMembers(of: type, with: typer)
                }
            case .objectLiteralAddElement, .objectLiteralAddComputedProperty, .objectLiteralCopyProperties,
                .objectLiteralSetPrototype, .beginObjectLiteralComputedMethod, .beginObjectLiteralComputedGetter,
                .beginObjectLiteralComputedSetter, .beginObjectLiteralGetter, .beginObjectLiteralSetter,
                .beginObjectLiteralMethod:
                literalsWithMoreThanProperties.insert(enclosingLiteral(of: instr.index))
            case .callFunction:
                noteCall(of: subroutineOfFunction[instr.input(0)], with: instr.inputs.dropFirst())
            case .construct:
                noteCall(of: constructorOfClass[instr.input(0)], with: instr.inputs.dropFirst())
            case .callMethod(let op):
                if let group = typer.type(of: instr.input(0)).group, let owner = classOfGroup[group] {
                    noteCall(of: methodsOfClass[owner]?[op.methodName], with: instr.inputs.dropFirst())
                }
            case .setProperty(let op):
                if let group = inferred[instr.input(0)]?.group, nameOfGroup[group] != nil {
                    let type = typer.type(of: instr.input(1))
                    propertiesStoredLater[group, default: [:]][op.propertyName, default: type] |= type
                }
            case .deleteProperty(let op):
                if let group = inferred[instr.input(0)]?.group { propertiesDeleted[group, default: []].insert(op.propertyName) }
            default:
                break
            }
        }
    }

    private var memberTypes = [String: [(name: String, type: ILType)]]()
    private var literalsWithMoreThanProperties = Set<Int>()

    private func readMembers(of type: ILType, with typer: JSTyper) -> [(name: String, type: ILType)] {
        type.properties.sorted().map { ($0, typer.inferPropertyType(of: $0, on: type)) }
    }

    private var indexOfDefinition = [Variable: Int]()

    private func definition(of v: Variable) -> Instruction? { indexOfDefinition[v].map { code[$0] } }

    /// The index of the instruction that ends the object literal around an instruction.
    private func enclosingLiteral(of index: Int) -> Int {
        var depth = 0
        for i in (index + 1)..<code.count {
            if code[i].op is BeginObjectLiteral { depth += 1 }
            if code[i].op is EndObjectLiteral {
                if depth == 0 { return i }
                depth -= 1
            }
        }
        return -1
    }

    private func parameterList(of op: BeginAnySubroutine, at index: Int) -> ParameterList? {
        guard let types = argumentTypes[index], op.parameters.destructuringParameters.isEmpty, op.parameters.count > 0 else {
            return nil
        }
        let fewest = fewestArguments[index] ?? 0
        var list = ParameterList()
        for i in 0..<op.parameters.count {
            if op.parameters.hasRestParameter && i == op.parameters.count - 1 {
                list.append(.rest(types.dropFirst(i).reduce(ILType.nothing, |).orAnything))
            } else if i < types.count && i < fewest {
                list.append(.plain(types[i].orAnything))
            } else {
                list.append(.opt(i < types.count ? types[i].orAnything : .jsAnything))
            }
        }
        return list
    }

    // MARK: From Fuzzilli's types to TypeScript's

    private static let libraryTypes: [String: TypeScriptType] = {
        var types: [String: TypeScriptType] = [
            "Object": .object, "Symbol": .symbol, "Function": .named("Function"), "RegExp": .named("RegExp"),
            "Promise": .generic("Promise", [.any]), "Map": .generic("Map", [.any, .any]), "Set": .generic("Set", [.any]),
            "WeakMap": .generic("WeakMap", [.object, .any]), "WeakSet": .generic("WeakSet", [.object]),
            "WeakRef": .generic("WeakRef", [.object]),
        ]
        for name in [
            "ArrayBuffer", "SharedArrayBuffer", "DataView", "Date", "Error", "EvalError", "RangeError", "ReferenceError",
            "SyntaxError", "TypeError", "URIError", "AggregateError", "Uint8Array", "Int8Array", "Uint16Array", "Int16Array",
            "Uint32Array", "Int32Array", "Float32Array", "Float64Array", "Uint8ClampedArray", "BigInt64Array",
            "BigUint64Array",
        ] {
            types[name] = .named(name)
        }
        return types
    }()

    private func translate(_ type: ILType, depth: Int = 0) -> TypeScriptType {
        if type == .jsAnything || type == .nothing || depth > 3 { return .any }
        var arms = [TypeScriptType]()
        if type.MayBe(.integer) || type.MayBe(.float) { arms.append(.number) }
        if type.MayBe(.string) { arms.append(.string) }
        if type.MayBe(.boolean) { arms.append(.boolean) }
        if type.MayBe(.bigint) { arms.append(.bigint) }
        if type.MayBe(.undefined) { arms += [.undefined, .null] }
        let isPrimitive = type.Is(.string) || type.Is(.number) || type.Is(.boolean) || type.Is(.bigint)
        if !isPrimitive {
            if type.MayBe(.function()) || type.MayBe(.constructor()) {
                if let group = type.group, group.hasPrefix("_fuzz_Constructor"),
                    let instance = type.constructorSignature?.outputType.group, let name = nameOfGroup[instance]
                {
                    arms.append(.classOf(name))
                } else if type.MayBe(.function()), !type.MayBe(.constructor()), let signature = type.functionSignature {
                    arms.append(translate(signature, depth: depth + 1))
                } else {
                    arms.append(.named("Function"))
                }
            } else if type.MayBe(.object()) || type.MayBe(.regexp) {
                switch type.group {
                case "Array"?:
                    arms.append(.array(type.iterableElementType.map { translate($0, depth: depth + 1) } ?? .any))
                case "String"?:
                    break
                case let group?:
                    guard let known = nameOfGroup[group].map(TypeScriptType.named) ?? Self.libraryTypes[group] else { return .any }
                    arms.append(known)
                case nil:
                    arms.append(type.MayBe(.regexp) && !type.MayBe(.object()) ? .named("RegExp") : .object)
                }
            }
        }
        return arms.count > 4 ? .any : .union(of: arms)
    }

    private func translate(_ signature: Signature, depth: Int) -> TypeScriptType {
        var parameters = [TypeScriptParameter]()
        var optional = false
        for (i, parameter) in signature.parameters.enumerated() {
            switch parameter {
            case .plain(let type):
                parameters.append(.init(name: "p\(i)", type: translate(type, depth: depth), isOptional: optional))
            case .opt(let type):
                optional = true
                parameters.append(.init(name: "p\(i)", type: translate(type, depth: depth), isOptional: true))
            case .rest(let type):
                parameters.append(.init(name: "p\(i)", type: .array(translate(type, depth: depth)), isRest: true))
            case .either(let first, let second):
                parameters.append(.init(name: "p\(i)", type: translate(first | second, depth: depth), isOptional: optional))
            }
        }
        return .function(parameters, translate(signature.outputType, depth: depth))
    }

    // MARK: The choices

    private enum Truth { case absent, right, wider, wrong }

    private func chooseTruth() -> Truth {
        [.absent, .right, .wider, .wrong][choices.weighted([settings.absent, settings.right, settings.wider, settings.wrong])]
    }

    private var namedTypes: [String] { interfaceOrder }

    private func widen(_ type: TypeScriptType) -> TypeScriptType {
        var candidates: [TypeScriptType] = [
            .any, .unknown, .union(of: [type, .undefined]), .union(of: [type, .null]),
            .union(of: [type, choices.pick([.number, .string, .boolean, .bigint, .object])]),
        ]
        if case .named(let name) = type, let base = baseOf[name] { candidates += [.named(base), .named(base)] }
        if case .named(let name) = type {
            candidates.append(.object)
            if name.hasPrefix("O") {
                helpers.insert("Same")
                candidates += [
                    .generic("Readonly", [type]), .generic("Partial", [type]), .alias("Same<\(name)>", type),
                    .alias("NonNullable<\(name)>", type), .alias("\(name) & {}", type),
                ]
            }
        }
        if case .array(let element) = type {
            candidates += [.readonlyArray(element), .array(.union(of: [element, .string])), .array(.any), .array(.unknown)]
        }
        if type == .int32 { candidates.append(.number) }
        if let other = namedTypes.randomElement(using: &choices) { candidates.append(.union(of: [type, .named(other)])) }
        return choices.pick(candidates)
    }

    private func falsify(_ type: TypeScriptType) -> TypeScriptType {
        var candidates: [TypeScriptType] = [.number, .string, .boolean, .bigint, .array(.number), .array(.string)]
        for name in namedTypes { candidates += [.named(name), .named(name)] }
        if case .array(let element) = type { candidates += [.array(falsify(element)), .tuple([element]), .tuple([element, .string])] }
        if type.arms.contains(where: \.isNullish) { candidates += [type.withoutNullish, type.withoutNullish] }
        candidates.removeAll { assignable($0, to: type) || assignable(type, to: $0) }
        guard !candidates.isEmpty else { return type == .number ? .string : .number }
        return choices.pick(candidates)
    }

    /// The type to write at a declaration of something that has the given type, or nothing.
    private func chooseAnnotation(for right: TypeScriptType) -> TypeScriptType? {
        switch chooseTruth() {
        case .absent: return nil
        case .right: return right
        case .wider: return widen(right)
        case .wrong: return falsify(right)
        }
    }

    // MARK: What the checker accepts

    private func assignable(_ aliasedSource: TypeScriptType, to aliasedTarget: TypeScriptType) -> Bool {
        let (source, target) = (aliasedSource.plain, aliasedTarget.plain)
        if source == target || target == .any || target == .unknown || source == .any { return source != .untracked }
        switch (source, target) {
        case (.untracked, _), (_, .untracked), (.unknown, _): return false
        case (.union(let arms), _): return arms.allSatisfy { assignable($0, to: target) }
        case (_, .union(let arms)): return arms.contains { assignable(source, to: $0) }
        case (.int32, .number), (.undefined, .void): return true
        case (.named(let name), .named):
            return baseOf[name].map { assignable(.named($0), to: target) } ?? false
        case (.named, .object), (.array, .object), (.generic, .object), (.tuple, .object), (.function, .object),
            (.classOf, .object), (.readonlyArray, .object):
            return true
        case (.array(let a), .array(let b)), (.array(let a), .readonlyArray(let b)),
            (.readonlyArray(let a), .readonlyArray(let b)):
            return assignable(a, to: b)
        case (.tuple(let elements), .array(let b)), (.tuple(let elements), .readonlyArray(let b)):
            return elements.allSatisfy { assignable($0, to: b) }
        case (.function, .named("Function")), (.classOf, .named("Function")): return true
        case (.named, .generic("Readonly", let arguments)), (.named, .generic("Partial", let arguments)):
            return assignable(source, to: arguments[0])
        default: return false
        }
    }

    private func member(_ name: String, of type: TypeScriptType) -> Member? {
        switch type.plain {
        case .named(let owner):
            return members[owner]?[name] ?? baseOf[owner].flatMap { member(name, of: .named($0)) }
        case .string, .array, .readonlyArray, .tuple:
            return name == "length" ? Member(type: .number, isReadonly: true) : nil
        default:
            return nil
        }
    }

    private func isArray(_ type: TypeScriptType) -> Bool {
        if case .array = type { return true }
        return false
    }

    // MARK: The declared types

    private func declareTypes() {
        let groups = nameOfGroup.keys.sorted { (nameOfGroup[$0]!.count, nameOfGroup[$0]!) < (nameOfGroup[$1]!.count, nameOfGroup[$1]!) }
        for group in groups { interfaceOrder.append(nameOfGroup[group]!) }
        for group in groups {
            let name = nameOfGroup[group]!
            var table = [String: Member]()
            var fields: Set<String>? = nil
            if let owner = classOfGroup[group] {
                fields = fieldsOfClass[owner] ?? []
                if case .beginClassDefinition(let op) = definition(of: owner)?.op.opcode, op.hasSuperclass { fields = [] }
            }
            for (property, type) in memberTypes[group] ?? [] where fields?.contains(property) ?? true {
                var member = Member(type: translate(type))
                if let later = propertiesStoredLater[group]?[property] { member.type = .union(of: [member.type, translate(later)]) }
                switch chooseTruth() {
                case .absent, .right: break
                case .wider: member.type = widen(member.type)
                case .wrong: member.type = falsify(member.type)
                }
                member.isOptional = propertiesDeleted[group]?.contains(property) ?? false
                member.isReadonly = propertiesStoredLater[group]?[property] == nil && choices.percent(15)
                table[property] = member
            }
            if classOfGroup[group] == nil {
                for (property, type) in (propertiesStoredLater[group] ?? [:]).sorted(by: { $0.key < $1.key }) where table[property] == nil {
                    table[property] = Member(type: translate(type), isOptional: true)
                }
            }
            if classOfGroup[group] == nil, choices.percent(15) {
                table["neverStored"] = Member(type: choices.pick([.number, .string, .array(.number), .named(name)]), isOptional: true)
            }
            if classOfGroup[group] == nil, table.count >= 2, choices.percent(30) {
                let inherited = table.keys.sorted().prefix(1 + choices.below(table.count - 1))
                members["\(name)Base"] = table.filter { inherited.contains($0.key) }
                table = table.filter { !inherited.contains($0.key) }
                baseOf[name] = "\(name)Base"
                basesWithMembers.append(name)
            }
            members[name] = table
        }
    }

    // MARK: Following the program

    private func type(of v: Variable) -> TypeScriptType { declared[v] ?? .untracked }

    private func rightType(of v: Variable) -> TypeScriptType { inferred[v].map { translate($0) } ?? .any }

    private func isLabel(_ v: Variable) -> Bool {
        guard let type = inferred[v] else { return false }
        return type.Is(.jsLoopLabel) || type.Is(.jsBlockLabel)
    }

    /// Goes through the program in order, as the checker does, and decides what each instruction needs.
    private func follow() {
        var codeStringDepth = 0
        var classNames = [String?]()
        var subroutines = [(begin: Int, result: TypeScriptType?)]()
        var openClasses = [Variable]()
        var derivedClasses = [Bool]()

        for instr in code {
            if instr.op is EndCodeString { codeStringDepth -= 1 }
            defer { if instr.op is BeginCodeString { codeStringDepth += 1 } }
            if codeStringDepth > 0 { continue }

            let index = instr.index
            func convert(_ i: Int, _ conversion: Conversion) { inputConversions[index, default: [:]][i] = conversion }
            func canConvert(_ i: Int) -> Bool { !instr.reassigns(instr.input(i)) && !isLabel(instr.input(i)) }
            /// Makes the checker accept the instruction whatever its inputs are. Returns whether it does so by ignoring the line.
            @discardableResult
            func giveUp(from first: Int = 0) -> Bool {
                let convertible = (first..<instr.numInputs).filter(canConvert)
                let namesBuiltin = instr.numInputs > 0 && code[indexOfDefinition[instr.input(0)] ?? 0].op is CreateNamedVariable
                if let i = convertible.first, !instr.isBlock, choices.percent(settings.ignoredLine * (namesBuiltin ? 2 : 1)) {
                    convert(i, .ignoredLine)
                    return true
                }
                for i in convertible { convert(i, .toAny) }
                return false
            }
            defer {
                // A name that nothing declares, and a class inside its own body, are errors wherever they stand.
                for (i, v) in instr.inputs.enumerated() where acceptance == .casts && (unknownNames.contains(v) || openClasses.contains(v)) {
                    convert(i, .ignoredLine)
                }
            }
            /// Makes an input fit a position of the given type.
            func pass(_ i: Int, into target: TypeScriptType) {
                if !assignable(type(of: instr.input(i)), to: target) { convert(i, .toAny) }
            }
            func passArguments(_ callable: Callable, from first: Int) -> Bool {
                let count = instr.numInputs - first
                let required = callable.parameters.filter { !$0.isOptional && !$0.isRest }.count
                let hasRest = callable.parameters.last?.isRest ?? false
                guard callable.isTracked, count >= required, hasRest || count <= callable.parameters.count else { return false }
                for i in 0..<count {
                    let parameter = callable.parameters[min(i, callable.parameters.count - 1)]
                    var target = parameter.type
                    if parameter.isRest, case .array(let element) = target { target = element }
                    if target == .int32, !isSmallWholeNumber(instr.input(first + i)) { return false }
                    if i == callable.genericPosition {
                        // The checker infers the type argument from the argument.
                        if callable.isBounded || type(of: instr.input(first + i)) == .untracked { convert(first + i, .toAny) }
                        continue
                    }
                    if parameter.isOptional { target = .union(of: [target, .undefined]) }
                    pass(first + i, into: target)
                }
                return true
            }
            func inputIsLiteral(_ i: Int) -> Bool { literals.contains(instr.input(i)) }
            /// A condition that the checker can see through is an error.
            func passCondition(_ i: Int) {
                switch type(of: instr.input(i)) {
                case .number, .int32, .string, .boolean, .bigint, .any, .union:
                    if inputIsLiteral(i) { convert(i, .toAny) }
                default: convert(i, .toAny)
                }
            }

            if acceptance != .casts {
                produceWithoutChecking(instr, &classNames, &subroutines)
                continue
            }

            switch instr.op.opcode {
            case .loadInteger(let op):
                if !reassigned.contains(instr.output), op.value.magnitude < 1 << 31, choices.percent(10) {
                    let name = "N\(op.value < 0 ? "_" : "")\(op.value.magnitude)"
                    enumMembers[name] = "\(op.value)"
                    outputConversions[instr.output] = .replaced("Numbers.\(name)")
                }
                produce(instr.output, .number, isLiteral: true)
            case .loadFloat:
                produce(instr.output, .number, isLiteral: true)
            case .loadString:
                produce(instr.output, .string, isLiteral: true)
            case .loadBoolean:
                produce(instr.output, .boolean, isLiteral: true)
            case .loadBigInt:
                produce(instr.output, .bigint, isLiteral: true)
            case .loadUndefined:
                produce(instr.output, .undefined, isLiteral: true)
            case .loadNull:
                produce(instr.output, .null, isLiteral: true)
            case .loadRegExp:
                // The checker reads the pattern, and Fuzzilli's patterns needn't be valid.
                declared[instr.output] = .named("RegExp")
                outputConversions[instr.output] = .ignoredLine

            case .createIntArray, .createFloatArray:
                produce(instr.output, .array(.number))
            case .createArray:
                let elements = instr.inputs.map { type(of: $0) == .int32 ? .number : type(of: $0) }
                if (1...4).contains(elements.count), !elements.contains(.untracked), !reassigned.contains(instr.output), choices.percent(25) {
                    annotations[instr.output] = .tuple(elements)
                    pinned.insert(instr.output)
                    declared[instr.output] = .tuple(elements)
                } else if let first = elements.first, first != .untracked, !first.isNullish, elements.allSatisfy({ $0 == first }) {
                    produce(instr.output, .array(first == .int32 ? .number : first))
                } else {
                    for i in 0..<instr.numInputs { convert(i, .toAny) }
                    produce(instr.output, instr.numInputs == 0 ? .untracked : .array(.any))
                }

            case .binaryOperation(let op):
                let (a, b) = (type(of: instr.input(0)), type(of: instr.input(1)))
                switch op.op {
                case .LogicAnd, .LogicOr, .NullCoalesce:
                    produce(instr.output, .untracked, onIgnoredLine: giveUp())
                case .Add where a == .string && [.string, .number, .int32, .boolean].contains(b),
                    .Add where b == .string && [.number, .int32, .boolean].contains(a):
                    produce(instr.output, .string)
                default:
                    if a.isNumber && b.isNumber {
                        produce(instr.output, .number)
                    } else if a == .bigint && b == .bigint && op.op != .UnRShift {
                        produce(instr.output, .bigint)
                    } else {
                        produce(instr.output, .untracked, onIgnoredLine: giveUp())
                    }
                }

            case .unaryOperation(let op):
                let a = type(of: instr.input(0))
                switch op.op {
                case .LogicalNot:
                    passCondition(0)
                    produce(instr.output, .boolean)
                case .PreInc, .PreDec, .PostInc, .PostDec:
                    if a != .number { convert(0, .toAny) }
                    produce(instr.output, a == .number ? .number : .untracked)
                default:
                    if !a.isNumber { convert(0, .toAny) }
                    produce(instr.output, a.isNumber ? .number : .untracked)
                }

            case .compare(let op):
                let (a, b) = (type(of: instr.input(0)), type(of: instr.input(1)))
                let isOrdering = [.lessThan, .lessThanOrEqual, .greaterThan, .greaterThanOrEqual].contains(op.op)
                let sameKind = (a.isNumber && b.isNumber) || (a == .string && b == .string) || (a == .bigint && b == .bigint)
                if !sameKind || (!isOrdering && (inputIsLiteral(0) || inputIsLiteral(1))) {
                    convert(0, .toAny)
                    convert(1, .toAny)
                }
                produce(instr.output, .boolean)

            case .typeOf:
                produce(instr.output, .string)

            case .getProperty(let op):
                if !op.isReceiverOptional, let member = member(op.propertyName, of: type(of: instr.input(0))), !member.isMethod {
                    produce(instr.output, member.isOptional ? .union(of: [member.type, .undefined]) : member.type)
                } else {
                    produce(instr.output, .untracked, onIgnoredLine: giveUp())
                }

            case .setProperty(let op):
                if let member = member(op.propertyName, of: type(of: instr.input(0))), !member.isReadonly, !member.isMethod,
                    member.type != .int32
                {
                    pass(1, into: member.type)
                } else {
                    giveUp()
                }

            case .getElement(let op):
                switch type(of: instr.input(0)) {
                case .array(let element) where op.index >= 0 && !op.isReceiverOptional,
                    .readonlyArray(let element) where op.index >= 0 && !op.isReceiverOptional:
                    produce(instr.output, element)
                case .tuple(let elements) where op.index >= 0 && op.index < elements.count && !op.isReceiverOptional:
                    produce(instr.output, elements[Int(op.index)])
                default:
                    produce(instr.output, .untracked, onIgnoredLine: giveUp())
                }

            case .setElement(let op):
                if case .array(let element) = type(of: instr.input(0)), op.index >= 0 {
                    pass(1, into: element)
                } else {
                    giveUp()
                }

            case .callFunction(let op):
                if !op.isCallOptional, let callable = callables[instr.input(0)], passArguments(callable, from: 1) {
                    produce(instr.output, callable.returnsTypeParameter ? .untracked : callable.result)
                } else {
                    produce(instr.output, .untracked, onIgnoredLine: giveUp())
                }

            case .construct:
                if case .classOf(let name) = type(of: instr.input(0)), let callable = constructors[name],
                    passArguments(callable, from: 1)
                {
                    produce(instr.output, .named(name))
                } else {
                    produce(instr.output, .untracked, onIgnoredLine: giveUp())
                }

            case .callMethod(let op):
                if !op.isReceiverOptional, !op.isCallOptional, case .named(let name) = type(of: instr.input(0)),
                    let callable = method(op.methodName, of: name), passArguments(callable, from: 1)
                {
                    produce(instr.output, callable.result)
                } else if !op.isReceiverOptional, !op.isCallOptional,
                    let callable = libraryMethod(op.methodName, of: type(of: instr.input(0))), passArguments(callable, from: 1)
                {
                    produce(instr.output, callable.result)
                } else {
                    produce(instr.output, .untracked, onIgnoredLine: giveUp())
                }

            case .getComputedProperty(let op):
                if !op.isReceiverOptional, type(of: instr.input(1)).isNumber, let element = elementType(of: type(of: instr.input(0))) {
                    produce(instr.output, element)
                } else {
                    produce(instr.output, .untracked, onIgnoredLine: giveUp())
                }

            case .setComputedProperty:
                if type(of: instr.input(1)).isNumber, case .array(let element) = type(of: instr.input(0)).plain {
                    pass(2, into: element)
                } else {
                    giveUp()
                }

            case .beginForLoop(let op):
                if op.type == .forOf, !op.isAsync, op.usingType == .none, op.header == .simple,
                    let element = elementType(of: type(of: instr.input(0)))
                {
                    declared[instr.innerOutput(0)] = element
                } else {
                    giveUp()
                    for v in instr.allOutputs { declared[v] = .untracked }
                }

            case .reassign:
                if declarationsThatCannotBeStoredTo.contains(instr.input(0)) { convert(0, .toAny) }
                pass(1, into: type(of: instr.input(0)))

            case .destructAndReassign:
                convert(0, .ignoredLine)

            case .createNamedVariable(let op):
                if op.declarationMode == .global { convert(0, .ignoredLine) } else if op.hasInitialValue { convert(0, .toAny) }
                declared[instr.output] = .untracked

            case .update(let op):
                let (a, b) = (type(of: instr.input(0)), type(of: instr.input(1)))
                let isLogical = [.LogicAnd, .LogicOr, .NullCoalesce].contains(op.op)
                if isLogical || !(a == .number && b.isNumber) {
                    if a != .number || isLogical { convert(0, .toAny) }
                    convert(1, .toAny)
                }

            case .dup:
                produce(instr.output, type(of: instr.input(0)), canConvert: false)

            case .return(let op):
                guard op.hasReturnValue else { break }
                if let result = subroutines.last?.result { pass(0, into: result) }

            case .beginIf, .beginWhileLoopBody, .endDoWhileLoop:
                if instr.numInputs > 0 { passCondition(0) }

            case .ternaryOperation:
                passCondition(0)
                produce(instr.output, .untracked)

            case .beginObjectLiteral:
                break

            case .endClassDefinition:
                classNames.removeLast()
                openClasses.removeLast()
                derivedClasses.removeLast()

            case .classAddComputedProperty:
                convert(0, .ignoredLine)

            case .getSuperProperty, .getComputedSuperProperty, .callSuperMethod:
                giveUp()
                declared[instr.output] = .untracked
                if derivedClasses.last == false { outputConversions[instr.output] = .ignoredLine }

            case .setSuperProperty, .setComputedSuperProperty, .updateSuperProperty:
                if derivedClasses.last == false { convert(0, .ignoredLine) } else { giveUp() }

            case .objectLiteralAddProperty(let op):
                let end = enclosingLiteral(of: index)
                if end >= 0, repeatedKeys(ofLiteralEndingAt: end).contains(op.propertyName) {
                    convert(0, .ignoredLine)
                } else if end >= 0, let group = inferred[code[end].output]?.group, let name = nameOfGroup[group],
                    let member = members[name]?[op.propertyName]
                {
                    if member.type == .int32, !inputIsLiteral(0) { convert(0, .toAny) } else { pass(0, into: member.type) }
                } else {
                    convert(0, .toAny)
                }

            case .endObjectLiteral:
                if let group = inferred[instr.output]?.group, let name = nameOfGroup[group],
                    !literalsWithMoreThanProperties.contains(index), repeatedKeys(ofLiteralEndingAt: index).isEmpty
                {
                    annotations[instr.output] = .named(name)
                    pinned.insert(instr.output)
                    declared[instr.output] = .named(name)
                } else {
                    declared[instr.output] = .untracked
                }

            case .beginClassDefinition(let op):
                if op.hasSuperclass { convert(0, .toAny) }
                let name = op.isExpression || op.hasSuperclass ? nil : "C\(instr.output.number)"
                classNames.append(nameOfGroup.values.contains("C\(instr.output.number)") ? name : nil)
                openClasses.append(instr.output)
                derivedClasses.append(op.hasSuperclass)
                markRepeatedMembers(ofClassAt: index)
                declared[instr.output] = (classNames.last ?? nil).map(TypeScriptType.classOf) ?? .untracked
                if let name = classNames.last ?? nil { prepareClass(name, instr.output) }

            case .classAddProperty(let op):
                if !op.isStatic, let name = classNames.last ?? nil, let member = members[name]?[op.propertyName] {
                    let mark = op.hasValue ? (member.isOptional ? "?" : "") : (member.isOptional ? "?" : "!")
                    fieldAnnotations[index, default: ""] += "\(mark): \(member.type.text)"
                    if op.hasValue {
                        if member.type == .int32, !inputIsLiteral(0) { convert(0, .toAny) } else { pass(0, into: member.type) }
                    }
                } else if op.hasValue {
                    convert(0, .toAny)
                }

            case .beginPlainFunction, .beginArrowFunction:
                let callable = beginSubroutine(instr, parameters: instr.innerOutputs, canReturn: true)
                callables[instr.output] = callable
                declared[instr.output] =
                    callable.isTracked && callable.genericPosition == nil ? .function(callable.parameters, callable.result) : .untracked
                subroutines.append((index, returnAnnotations[index]))

            case .beginClassConstructor:
                let callable = beginSubroutine(instr, parameters: instr.innerOutputs.dropFirst(), canReturn: false)
                if let name = classNames.last ?? nil {
                    constructors[name] = callable
                    declared[instr.innerOutput(0)] = .named(name)
                }
                subroutines.append((index, nil))

            case .beginClassMethod(let op):
                let plain = !op.isGenerator && !op.isAsync
                let callable = beginSubroutine(instr, parameters: instr.innerOutputs.dropFirst(), canReturn: plain)
                if let name = classNames.last ?? nil, !op.isStatic {
                    if plain, !callable.returnsTypeParameter { methods[name, default: [:]][op.methodName] = callable }
                    declared[instr.innerOutput(0)] = .named(name)
                }
                subroutines.append((index, returnAnnotations[index]))

            default:
                if instr.op is BeginAnySubroutine {
                    subroutines.append((index, nil))
                    if instr.op is BeginConstructor { declarationsThatCannotBeStoredTo.insert(instr.output) }
                    if instr.op is BeginObjectLiteralMethod || instr.op is BeginObjectLiteralSetter { ignoredHeads.insert(index) }
                } else if instr.op is EndAnySubroutine {
                    subroutines.removeLast()
                    break
                }
                giveUp()
                for v in instr.allOutputs { declared[v] = .untracked }
            }
        }
    }

    private func elementType(of type: TypeScriptType) -> TypeScriptType? {
        switch type.plain {
        case .array(let element), .readonlyArray(let element): return element
        default: return nil
        }
    }

    /// The methods of arrays, strings and numbers that the plan follows.
    private func libraryMethod(_ name: String, of receiver: TypeScriptType) -> Callable? {
        func callable(_ parameters: [(TypeScriptType, optional: Bool, rest: Bool)], _ result: TypeScriptType) -> Callable {
            Callable(
                parameters: parameters.enumerated().map {
                    .init(name: "p\($0.offset)", type: $0.element.rest ? .array($0.element.0) : $0.element.0, isOptional: $0.element.optional, isRest: $0.element.rest)
                }, result: result)
        }
        let index: (TypeScriptType, optional: Bool, rest: Bool) = (.number, false, false)
        let optionalIndex: (TypeScriptType, optional: Bool, rest: Bool) = (.number, true, false)
        switch receiver.plain {
        case .array(let element), .readonlyArray(let element):
            let one: (TypeScriptType, optional: Bool, rest: Bool) = (element, false, false)
            switch name {
            case "includes": return callable([one], .boolean)
            case "indexOf", "lastIndexOf": return callable([one], .number)
            case "join": return callable([(.string, true, false)], .string)
            case "slice": return callable([optionalIndex, optionalIndex], .array(element))
            case "at": return callable([index], .union(of: [element, .undefined]))
            case "toString": return callable([], .string)
            default: break
            }
            guard isArray(receiver.plain) else { return nil }
            switch name {
            case "push", "unshift": return callable([(element, false, true)], .number)
            case "pop", "shift": return callable([], .union(of: [element, .undefined]))
            case "reverse", "sort": return callable([], .array(element))
            case "fill": return callable([one], .array(element))
            default: return nil
            }
        case .string:
            let text: (TypeScriptType, optional: Bool, rest: Bool) = (.string, false, false)
            switch name {
            case "charAt", "repeat": return callable([index], .string)
            case "charCodeAt": return callable([index], .number)
            case "at": return callable([index], .union(of: [.string, .undefined]))
            case "indexOf", "lastIndexOf": return callable([text], .number)
            case "includes", "startsWith", "endsWith": return callable([text], .boolean)
            case "slice": return callable([optionalIndex, optionalIndex], .string)
            case "substring": return callable([index, optionalIndex], .string)
            case "toUpperCase", "toLowerCase", "trim", "trimStart", "trimEnd", "toString": return callable([], .string)
            case "padStart", "padEnd": return callable([index, (.string, true, false)], .string)
            case "concat": return callable([(.string, false, true)], .string)
            case "split": return callable([text], .array(.string))
            default: return nil
            }
        case .number, .int32:
            switch name {
            case "toString", "toFixed": return callable([optionalIndex], .string)
            default: return nil
            }
        default:
            return nil
        }
    }

    private func isSmallWholeNumber(_ v: Variable) -> Bool {
        if type(of: v) == .int32 { return true }
        guard literals.contains(v), case .loadInteger(let op) = definition(of: v)?.op.opcode else { return false }
        return op.value >= -0x8000_0000 && op.value <= 0x7FFF_FFFF
    }

    private func method(_ name: String, of owner: String) -> Callable? {
        methods[owner]?[name] ?? baseOf[owner].flatMap { method(name, of: $0) }
    }

    /// The keys that an object literal has more than once.
    private func repeatedKeys(ofLiteralEndingAt end: Int) -> Set<String> {
        var seen = Set<String>()
        var repeated = Set<String>()
        var depth = 0
        for i in stride(from: end - 1, through: 0, by: -1) {
            if code[i].isBlockEnd { depth += 1 }
            if code[i].isBlockStart {
                if depth == 0 { break }
                depth -= 1
            }
            guard depth == 0 else { continue }
            let key: String
            switch code[i].op.opcode {
            case .objectLiteralAddProperty(let op): key = op.propertyName
            case .beginObjectLiteralMethod(let op): key = op.methodName
            case .beginObjectLiteralGetter(let op): key = op.propertyName
            case .beginObjectLiteralSetter(let op): key = op.propertyName
            default: continue
            }
            if !seen.insert(key).inserted { repeated.insert(key) }
        }
        return repeated
    }

    /// Two members of a class with one name are an error at each of them.
    private func markRepeatedMembers(ofClassAt begin: Int) {
        var first = [String: Int]()
        var depth = 0
        for i in (begin + 1)..<end(ofBlockAt: begin) {
            if code[i].isBlockEnd { depth -= 1 }
            defer { if code[i].isBlockStart { depth += 1 } }
            guard depth == 0 else { continue }
            let key: String
            switch code[i].op.opcode {
            case .classAddProperty(let op): key = "\(op.isStatic) \(op.propertyName)"
            case .beginClassMethod(let op): key = "\(op.isStatic) \(op.methodName)"
            case .beginClassGetter(let op): key = "\(op.isStatic) \(op.propertyName)"
            case .beginClassSetter(let op): key = "\(op.isStatic) \(op.propertyName)"
            case .classAddPrivateProperty(let op): key = "#\(op.propertyName)"
            case .beginClassPrivateMethod(let op): key = "#\(op.methodName)"
            default: continue
            }
            guard let earlier = first[key] else {
                first[key] = i
                continue
            }
            for member in [earlier, i] {
                if code[member].op is ClassAddProperty { fieldAnnotations[member] = Self.ignoredLineMarker } else { ignoredHeads.insert(member) }
            }
        }
    }

    /// A method can be called before the checker, or this plan, reaches its body.
    private func prepareClass(_ name: String, _ v: Variable) {
        if constructorOfClass[v] == nil { constructors[name] = Callable(parameters: [], result: .named(name)) }
    }

    /// Chooses the annotations of a function's parameters and of what it returns.
    private func beginSubroutine(_ instr: Instruction, parameters: ArraySlice<Variable>, canReturn: Bool) -> Callable {
        guard let op = instr.op as? BeginAnySubroutine else { fatalError("Not the start of a function") }
        var callable = Callable(parameters: [], result: .untracked)
        let isSimple = op.parameters.destructuringParameters.isEmpty
        let fewest = fewestArguments[instr.index] ?? op.parameters.count
        var optional = false
        // One parameter can have the type of a type parameter, which the function can also return.
        let typeParameter = TypeScriptType.named("T\(instr.index)")
        let genericPosition =
            acceptance == .casts && canReturn && isSimple && !parameters.isEmpty && choices.percent(settings.generic)
            ? choices.below(parameters.count) : -1
        for (i, v) in parameters.enumerated() {
            let name = "a\(v.number)"
            guard isSimple, !op.parameters.defaultParameterIndices.contains(i) else {
                declared[v] = .untracked
                callable.isTracked = false
                continue
            }
            let isRest = op.parameters.hasRestParameter && i == op.parameters.count - 1
            var right = rightType(of: v)
            if isRest, !isArray(right) { right = .array(.any) }
            var annotation = chooseAnnotation(for: right)
            if isRest, let chosen = annotation, !isArray(chosen) { annotation = .array(chosen) }
            if annotation == .number, !reassigned.contains(v), choices.percent(settings.int32) { annotation = .int32 }
            if i == genericPosition, !isRest, !reassigned.contains(v) {
                annotation = typeParameter
                let bound = choices.pick(["", "", " extends unknown", " = \(right.text)", " extends \(widen(right).text)"])
                genericHeads[instr.index] = "<\(typeParameter.text)\(bound)>"
                callable.genericPosition = i
                callable.isBounded = bound.hasPrefix(" extends") && bound != " extends unknown"
            }
            optional = !isRest && (optional || i >= fewest)
            if let annotation {
                parameterAnnotations[name] = (annotation, optional)
                declared[v] = optional ? .union(of: [annotation, .undefined]) : annotation
            } else {
                if optional { parameterAnnotations[name] = (.any, true) }
                declared[v] = isRest ? .array(.any) : .any
            }
            callable.parameters.append(
                .init(name: name, type: annotation ?? (isRest ? .array(.any) : .any), isOptional: optional, isRest: isRest))
        }
        if canReturn {
            let right = resultTypes[instr.index].map { translate($0) } ?? .any
            if var annotation = callable.genericPosition != nil && choices.percent(60) ? typeParameter : chooseAnnotation(for: right) {
                callable.returnsTypeParameter = annotation == typeParameter
                if !endsWithReturn(instr.index) { annotation = .union(of: [annotation, .undefined]) }
                if !containsReturn(instr.index) {
                    annotation = .void
                    callable.returnsTypeParameter = false
                }
                returnAnnotations[instr.index] = annotation
                callable.result = annotation
            }
        }
        return callable
    }

    private func end(ofBlockAt begin: Int) -> Int {
        var depth = 0
        for i in (begin + 1)..<code.count {
            if code[i].isBlockEnd {
                if depth == 0 { return i }
                depth -= 1
            }
            if code[i].isBlockStart { depth += 1 }
        }
        return code.count - 1
    }

    private func endsWithReturn(_ begin: Int) -> Bool {
        let last = end(ofBlockAt: begin) - 1
        if last > begin, case .return(let op) = code[last].op.opcode { return op.hasReturnValue }
        return false
    }

    private func containsReturn(_ begin: Int) -> Bool {
        var nested = 0
        for i in (begin + 1)..<end(ofBlockAt: begin) {
            if code[i].op is EndAnySubroutine { nested -= 1 }
            if nested == 0, case .return(let op) = code[i].op.opcode, op.hasReturnValue { return true }
            if code[i].op is BeginAnySubroutine { nested += 1 }
        }
        return false
    }

    /// Records what an instruction's result is, and decides how it's declared.
    private func produce(
        _ v: Variable, _ actual: TypeScriptType, isLiteral: Bool = false, canConvert: Bool = true, onIgnoredLine: Bool = false
    ) {
        declared[v] = actual
        if isLiteral { literals.insert(v) }
        let isReassigned = reassigned.contains(v)
        guard canConvert, isReassigned || choices.percent(isLiteral ? settings.declared / 4 : settings.declared) else { return }

        let right = actual == .untracked || actual == .any || isReassigned ? rightType(of: v) : actual
        guard var annotation = chooseAnnotation(for: right) else {
            if isReassigned { declared[v] = isLiteral && !actual.isNullish ? actual : .untracked }
            literals.remove(v)
            return
        }
        if annotation == .int32 || annotation == .void { annotation = .number }
        if annotation == .number, !isReassigned, isSmallWholeNumber(v), outputConversions[v] == nil, choices.percent(settings.int32) {
            annotations[v] = .int32
            pinned.insert(v)
            declared[v] = .int32
            literals.remove(v)
            return
        }
        guard outputConversions[v] == nil else { return }
        literals.remove(v)
        annotations[v] = annotation
        pinned.insert(v)
        declared[v] = annotation
        let fits = onIgnoredLine || assignable(actual, to: annotation)
        if choices.percent(settings.generic) {
            outputConversions[v] = detour(to: annotation)
        } else if !fits, actual.arms.contains(where: \.isNullish), assignable(actual.withoutNullish, to: annotation) {
            outputConversions[v] = .nonNull
        } else if !fits {
            outputConversions[v] = choices.percent(50) ? .toAny : .throughUnknown(annotation)
        } else if actual != .any, choices.percent(10) {
            outputConversions[v] = .satisfies(annotation)
        }
    }

    private func detour(to type: TypeScriptType) -> Conversion {
        if choices.percent(10) {
            helpers.insert("writeAsText")
            return .parsed(type)
        }
        let helper = choices.pick(Self.detours)
        helpers.insert(helper)
        return .helper(helper, type)
    }

    /// In a file that isn't checked, or where every line's errors are ignored, everything is annotated from Fuzzilli's types.
    private func produceWithoutChecking(
        _ instr: Instruction, _ classNames: inout [String?], _ subroutines: inout [(begin: Int, result: TypeScriptType?)]
    ) {
        switch instr.op.opcode {
        case .beginPlainFunction, .beginArrowFunction:
            _ = beginSubroutine(instr, parameters: instr.innerOutputs, canReturn: true)
        case .beginClassConstructor:
            _ = beginSubroutine(instr, parameters: instr.innerOutputs.dropFirst(), canReturn: false)
        case .beginClassMethod(let op):
            _ = beginSubroutine(instr, parameters: instr.innerOutputs.dropFirst(), canReturn: !op.isGenerator && !op.isAsync)
        case .beginClassDefinition(let op):
            classNames.append(op.isExpression ? nil : "C\(instr.output.number)")
        case .endClassDefinition:
            classNames.removeLast()
        case .classAddProperty(let op):
            if !op.isStatic, let name = classNames.last ?? nil, let member = members[name]?[op.propertyName] {
                fieldAnnotations[instr.index] = "\(member.isOptional ? "?" : ""): \(member.type.text)"
            }
        default:
            guard instr.numOutputs == 1, !instr.isBlock, !(instr.op is CreateNamedVariable), choices.percent(settings.declared),
                let annotation = chooseAnnotation(for: rightType(of: instr.output))
            else { break }
            annotations[instr.output] = annotation
            pinned.insert(instr.output)
            if annotation == .int32 { usesInt32 = true }
        }
    }

    // MARK: What the lifter asks for

    func convert(_ expression: Expression, input index: Int, of instr: Instruction) -> Expression {
        guard let conversion = inputConversions[instr.index]?[index] else { return expression }
        return apply(conversion, to: expression)
    }

    func convert(_ expression: Expression, producing v: Variable) -> Expression {
        guard let conversion = outputConversions[v] else { return expression }
        return apply(conversion, to: expression)
    }

    private func apply(_ conversion: Conversion, to expression: Expression) -> Expression {
        let e = expression.type.precedence >= 15 ? expression.text : "(\(expression.text))"
        let text: String
        switch conversion {
        case .toAny: text = "(\(e) as any)"
        case .to(let type): text = "(\(e) as \(type.text))"
        case .throughUnknown(let type): text = "(\(e) as unknown as \(type.text))"
        case .nonNull: text = "\(e)!"
        case .satisfies(let type): text = "(\(e) satisfies \(type.text))"
        case .helper(let name, let type): text = "\(name)<\(type.text)>(\(e) as any)"
        case .parsed(let type): text = "(JSON.parse(writeAsText(\(expression.text))) as \(type.text))"
        case .replaced(let replacement): return Expression(type: Identifier, text: replacement, numSubexpressions: 0)
        case .ignoredLine:
            text = expression.type === Identifier ? "\(Self.ignoredLineMarker)\(e)" : "(\(Self.ignoredLineMarker)\(expression.text))"
        }
        let type = expression.characteristic == .pure ? Identifier : EffectfulBracketedExpression
        return Expression(type: type, text: text, numSubexpressions: 0)
    }

    func isPinned(_ v: Variable) -> Bool { pinned.contains(v) }

    /// What follows the name where a variable is declared.
    func annotation(for v: Variable, hasInitializer: Bool = true) -> String {
        guard let type = annotations[v] else { return "" }
        return "\(hasInitializer ? "" : "!"): \(type.text)"
    }

    func parameterAnnotation(for name: String, hasDefaultValue: Bool) -> String {
        guard let (type, isOptional) = parameterAnnotations[name] else { return "" }
        return "\(isOptional && !hasDefaultValue ? "?" : ""): \(type.text)"
    }

    /// Stands behind the last parameter until `finish` puts the type behind the bracket.
    func returnMarker(at index: Int) -> String {
        (genericHeads[index] == nil ? "" : "/*generic \(index)*/") + (ignoredHeads.contains(index) ? Self.ignoredLineMarker : "") + (returnAnnotations[index] == nil ? "" : "/*returns \(index)*/")
    }

    func fieldAnnotation(at index: Int) -> String { fieldAnnotations[index] ?? "" }

    private static let detours = [
        "pass", "passThroughBox", "passThroughMap", "passThroughCallback", "passThroughKey", "passThroughList",
        "passThroughDefault", "passThroughSwitch", "passThroughPredicate", "passThroughFalsePredicate", "passThroughOverload",
        "passThroughPromiseType",
    ]

    private static let helperDeclarations: [String: String] = [
        "Same": "type Same<T> = { [K in keyof T]: T[K] };",
        "writeAsText": """
            function writeAsText(value: unknown): string {
                try {
                    return JSON.stringify(value) ?? "null";
                } catch {
                    return "null";
                }
            }
            """,
        "passThroughSwitch": """
            type Held<T> = { kind: "value"; value: T } | { kind: "list"; values: T[] } | { kind: "nothing" };
            function takeOut<T>(held: Held<T>, otherwise: T): T {
                switch (held.kind) {
                    case "value":
                        return held.value;
                    case "list":
                        return held.values[0];
                    default:
                        return otherwise;
                }
            }
            function passThroughSwitch<T>(value: T): T {
                return takeOut<T>({ kind: "list", values: [takeOut<T>({ kind: "value", value }, value)] }, value);
            }
            """,
        "passThroughPredicate": """
            function isAlways<T>(value: unknown): value is T { return true; }
            function passThroughPredicate<T>(value: unknown): T {
                if (isAlways<T>(value)) return value;
                return value as T;
            }
            """,
        "passThroughFalsePredicate": """
            function isNever<T>(value: unknown): value is T { return false; }
            function passThroughFalsePredicate<T>(value: T | string): T {
                if (isNever<string>(value)) return value.length as unknown as T;
                return value as T;
            }
            """,
        "passThroughOverload": """
            function passThroughOverload(value: number): number;
            function passThroughOverload(value: string): string;
            function passThroughOverload<T>(value: T): T;
            function passThroughOverload(value: unknown): unknown { return value; }
            """,
        "passThroughPromiseType": """
            type Settled<T> = T extends PromiseLike<infer V> ? Settled<V> : T;
            function passThroughPromiseType<T>(value: T): T {
                const settled = value as unknown as Settled<T>;
                return settled as unknown as T;
            }
            """,
        "pass": "function pass<T>(value: T): T { return value; }",
        "passThroughBox": """
            class Box<T> {
                constructor(public value: T) {}
                map<U>(change: (value: T) => U): Box<U> { return new Box<U>(change(this.value)); }
            }
            function passThroughBox<T>(value: T): T { return new Box<T>(value).map<T>(inner => inner).value; }
            """,
        "passThroughMap": """
            function passThroughMap<V, K extends string = "key">(value: V): V {
                const map = new Map<K, V>();
                map.set("key" as K, value);
                return map.get("key" as K)!;
            }
            """,
        "passThroughCallback": "function passThroughCallback<T>(value: T): T { return [value].map((element: T): T => element)[0]; }",
        "passThroughKey": """
            function readKey<T, K extends keyof T>(holder: T, key: K): T[K] { return holder[key]; }
            function passThroughKey<T>(value: T): T { return readKey({ held: value }, "held"); }
            """,
        "passThroughList": """
            type Elements<T> = T extends readonly (infer E)[] ? E : never;
            function passThroughList<T>(value: T): T {
                const list: Same<T[]> = [value];
                const first: Elements<typeof list> = list[0];
                return first;
            }
            """,
        "passThroughDefault": "function passThroughDefault<T = number, R extends T = T>(value: R): R { return value; }",
    ]

    /// Completes the text that the lifter wrote.
    func finish(_ lifted: String) -> String {
        var lines = [Substring]()
        var text = lifted
        for (index, type) in returnAnnotations {
            text = text.replacingOccurrences(of: "/*returns \(index)*/)", with: "): \(type.text)")
        }
        for (index, parameters) in genericHeads {
            // The marker stands behind the parameters. The type parameters belong in front of the bracket that opens them.
            guard let marker = text.range(of: "/*generic \(index)*/") else { continue }
            var depth = 0
            var position = marker.lowerBound
            while position > text.startIndex {
                position = text.index(before: position)
                if text[position] == ")" || text[position] == "]" || text[position] == "}" { depth += 1 }
                if text[position] == "[" || text[position] == "{" { depth -= 1 }
                if text[position] == "(" {
                    if depth == 0 { break }
                    depth -= 1
                }
            }
            text.removeSubrange(marker)
            text.insert(contentsOf: parameters, at: position)
        }
        var body = [String]()
        var openClassExpressions = [Substring]()
        lines = text.split(separator: "\n", omittingEmptySubsequences: false)
        for var line in lines {
            let indentation = line.prefix(while: { $0 == " " })
            // Fuzzilli ends a class expression without a semicolon, and a bracket at the start of the next line would call it.
            if line.hasSuffix("{"), line.contains(" = class {") || line.contains(" = class extends ") {
                openClassExpressions.append(indentation)
            } else if let open = openClassExpressions.last, line == open + "}" {
                openClassExpressions.removeLast()
                line += ";"
            }
            if line.contains(Self.ignoredLineMarker) {
                body.append("\(indentation)// @ts-ignore")
                body.append(line.replacingOccurrences(of: Self.ignoredLineMarker, with: ""))
            } else {
                let words = line.dropFirst(indentation.count)
                let isGetter = (words.hasPrefix("get ") || words.hasPrefix("static get ")) && words.hasSuffix("() {")
                if acceptance == .everyLineIgnored || (acceptance == .casts && isGetter), !line.isEmpty {
                    body.append("\(indentation)// @ts-ignore")
                }
                body.append(String(line))
            }
        }

        var head = [String]()
        if acceptance == .uncheckedFile { head.append("// @ts-nocheck") }
        if usesInt32 || text.contains(": int32") { head.append("import type { int32 } from \"bun\";") }
        head.append("const printValue = console.log;")
        if helpers.contains("passThroughList") { helpers.insert("Same") }
        for helper in helpers.sorted() { head.append(Self.helperDeclarations[helper]!) }
        if !enumMembers.isEmpty {
            let list = enumMembers.sorted(by: { $0.key < $1.key }).map { "    \($0.key) = \($0.value)," }
            head.append("\(enumMembers.count % 2 == 0 ? "const " : "")enum Numbers {\n\(list.joined(separator: "\n"))\n}")
        }
        for name in interfaceOrder.flatMap({ basesWithMembers.contains($0) ? ["\($0)Base", $0] : [$0] }) where name.hasPrefix("O") {
            let fields = (members[name] ?? [:]).sorted(by: { $0.key < $1.key }).map { key, member in
                "    \(member.isReadonly ? "readonly " : "")\(propertyKey(key))\(member.isOptional ? "?" : ""): \(member.type.text);"
            }
            let base = baseOf[name].map { " extends \($0)" } ?? ""
            if base.isEmpty, !basesWithMembers.contains(String(name.dropLast(4))), name.utf8.reduce(0, { $0 + Int($1) }) % 3 == 0 {
                head.append("type \(name) = {\n\(fields.joined(separator: "\n"))\n};")
            } else {
                head.append("interface \(name)\(base) {\n\(fields.joined(separator: "\n"))\n}")
            }
        }

        var tail = [String]()
        var printed = Set<String>()
        for line in lines {
            for keyword in ["const ", "let ", "var ", "class ", "function ", "function* ", "async function ", "async function* "]
            where line.hasPrefix(keyword) {
                let name = String(line.dropFirst(keyword.count).prefix(while: { $0.isLetter || $0.isNumber || $0 == "_" || $0 == "$" }))
                if !name.isEmpty, printed.insert(name).inserted {
                    if acceptance == .everyLineIgnored { tail.append("// @ts-ignore") }
                    tail.append("printValue(\"\(name)\", \(name));")
                }
            }
        }
        tail.append("export {};")
        return (head + body + tail).joined(separator: "\n") + "\n"
    }

    private func propertyKey(_ name: String) -> String {
        environment.isValidIdentifierOrIndex(name) ? name : "\"\(name)\""
    }
}

extension ILType {
    fileprivate var orAnything: ILType { self == .nothing ? .jsAnything : self }
}

extension Array {
    fileprivate func randomElement(using choices: inout ChoiceGenerator) -> Element? {
        isEmpty ? nil : self[choices.below(count)]
    }
}
