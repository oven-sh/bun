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
    /// How often the declarations in front of a program are in files of their own.
    var files = 0
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
            case "files": settings.files = value
            case "seed": settings.seed = UInt64(value)
            default: fatalError("BUN_FUZZILLI_TYPES: unknown setting \(part)")
            }
        }
        return settings
    }()
}

private func mix(_ a: UInt64, _ b: UInt64) -> UInt64 {
    var z = (a ^ (b &* 0x9E37_79B9_7F4A_7C15)) &+ 0x9E37_79B9_7F4A_7C15
    z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
    z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
    return z ^ (z >> 31)
}

private func mix<Bytes: Sequence>(_ a: UInt64, _ bytes: Bytes) -> UInt64 where Bytes.Element == UInt8 {
    var hash = a ^ 0xCBF2_9CE4_8422_2325
    for byte in bytes { hash = (hash ^ UInt64(byte)) &* 0x100_0000_01B3 }
    return mix(hash, 0)
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
    /// A union of literals, as it is written, and the primitive that they all are.
    case literals(String, TypeScriptType)
    /// An object of the library, such as `Math`.
    case library(String)

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
        case .alias(let text, _), .literals(let text, _): return text
        case .library(let name): return "typeof \(name)"
        }
    }

    /// The type without another spelling of it.
    var plain: TypeScriptType {
        if case .alias(_, let type) = self { return type.plain }
        return self
    }

    private var bracketed: String {
        switch self {
        case .union, .function, .readonlyArray, .classOf, .alias, .literals, .library: return "(\(text))"
        default: return text
        }
    }

    var arms: [TypeScriptType] {
        if case .union(let arms) = self { return arms }
        return [self]
    }

    var isNumber: Bool {
        if case .literals(_, let base) = self { return base.isNumber }
        return plain == .number || plain == .int32
    }
    var isLiterals: Bool {
        if case .literals = self { return true }
        return false
    }
    /// Whether a literal that isn't one of an enum's members is refused here.
    var mentionsEnumeration: Bool {
        arms.contains {
            if case .alias("Numbers", _) = $0 { return true }
            return false
        }
    }
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
        /// Through a generic function that gives its argument the type.
        case through(String, TypeScriptType)
        case wholeNumber
        case asConstant
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
    private var hasSeveralFiles = false

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
    private var textMembers = [String: String]()
    private var enumsAreConstant: Bool { seedOfProgram % 2 == 0 }
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
        self.choices = ChoiceGenerator(state: 0)
        for instr in code {
            for v in instr.inputs where instr.reassigns(v) { reassigned.insert(v) }
            for v in instr.allOutputs { indexOfDefinition[v] = instr.index }
        }
        findPlaces()
        choices = ChoiceGenerator(state: mix(seedOfProgram, 1))

        switch choices.weighted([
            100 - settings.uncheckedFile - settings.everyLineIgnored, settings.everyLineIgnored, settings.uncheckedFile,
        ]) {
        case 1: acceptance = code.contains(where: { $0.op is BeginCodeString }) ? .casts : .everyLineIgnored
        case 2: acceptance = .uncheckedFile
        default: acceptance = .casts
        }
        hasSeveralFiles = choices.percent(settings.files)

        inferTypes(usingArguments: false)
        inferTypes(usingArguments: true)
        declareTypes()
        follow()
    }

    // MARK: Where a choice is made

    /// A string that starts like this seeds the choices that are made behind it in its block.
    static let seedPrefix = "types "

    static func seed(in instr: Instruction) -> UInt64? {
        guard case .loadString(let op) = instr.op.opcode, op.value.hasPrefix(seedPrefix) else { return nil }
        return mix(0, op.value.utf8)
    }

    private var seedOfProgram: UInt64 = 0
    private var seeds = [UInt64]()
    private var places = [UInt64]()
    private var placeOfVariable = [Variable: UInt64]()

    /// Gives every instruction a number that is computed from the instruction, from what it uses and, where it starts
    /// or ends a block, from one instruction of the block. The choices at an instruction are drawn from that number,
    /// so they stay as they are when other parts of the program are removed, added or renumbered.
    private func findPlaces() {
        var contents = [UInt64](repeating: 0, count: code.count)
        var leastInside = [UInt64](repeating: .max, count: code.count)
        var leastBefore = [UInt64](repeating: .max, count: code.count)
        var open = [Int]()
        var firstSeed: UInt64? = nil
        var everything: UInt64 = 0
        for instr in code {
            let seed = Self.seed(in: instr)
            if firstSeed == nil { firstSeed = seed }
            var content = mix(0, instr.op.name.utf8)
            if !instr.isInternal {
                var written = instr.asProtobuf()
                written.inouts = []
                content = mix(content, (try? written.serializedData()) ?? Data())
            }
            contents[instr.index] = content
            everything = mix(everything, content)
            for input in instr.inputs { everything = mix(everything, UInt64(input.number)) }
            if instr.isBlockEnd, let begin = open.popLast() {
                leastBefore[instr.index] = leastInside[begin]
                if let parent = open.last { leastInside[parent] = min(leastInside[parent], leastInside[begin]) }
            }
            if !instr.isNop, seed == nil, let block = open.last { leastInside[block] = min(leastInside[block], content) }
            if instr.isBlockStart { open.append(instr.index) }
        }

        seedOfProgram = mix(settings.seed, firstSeed ?? everything)
        var scopes = [seedOfProgram]
        for instr in code {
            if instr.isBlockEnd, scopes.count > 1 { scopes.removeLast() }
            if let seed = Self.seed(in: instr) { scopes[scopes.count - 1] = mix(settings.seed, seed) }
            seeds.append(scopes[scopes.count - 1])
            if instr.isBlockStart { scopes.append(scopes[scopes.count - 1]) }
            var place = mix(contents[instr.index], instr.isBlockStart ? leastInside[instr.index] : leastBefore[instr.index])
            for input in instr.inputs { place = mix(place, placeOfVariable[input] ?? 0) }
            places.append(place)
            for (i, v) in instr.allOutputs.enumerated() { placeOfVariable[v] = mix(place, UInt64(i + 1)) }
        }
    }

    /// Starts the choices of an instruction.
    private func choose(at index: Int, for purpose: UInt64 = 0) {
        choices = ChoiceGenerator(state: mix(mix(seeds[index], places[index]), purpose))
    }

    /// One of the declared types. Which one it is doesn't change when others are removed.
    private func pickNamedType(where isCandidate: (String) -> Bool = { _ in true }) -> String? {
        let salt = choices.next()
        return interfaceOrder.filter(isCandidate).max { mix(salt, placeOfName[$0] ?? 0) < mix(salt, placeOfName[$1] ?? 0) }
    }

    private var placeOfName = [String: UInt64]()
    private var siteOfGroup = [String: Int]()

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
                if let current = classes.last, !op.isStatic {
                    fieldsOfClass[current, default: []].insert(op.propertyName)
                    if op.hasValue { fieldsWithValues[current, default: []].insert(op.propertyName) }
                }
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
                    siteOfGroup[group] = indexOfDefinition[current] ?? instr.index
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
                    siteOfGroup[group] = instr.index
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
            case .callSuperConstructor:
                if let current = classes.last, let head = definition(of: current), head.numInputs > 0 {
                    noteCall(of: constructorOfClass[head.input(0)], with: instr.inputs[...])
                }
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
        if type == .number { candidates += [.alias("Numbers", .number), .alias("Numbers", .number)] }
        if let other = pickNamedType() { candidates.append(.union(of: [type, .named(other)])) }
        return choices.pick(candidates)
    }

    private func falsify(_ type: TypeScriptType) -> TypeScriptType {
        func isWrong(_ candidate: TypeScriptType) -> Bool { !assignable(candidate, to: type) && !assignable(type, to: candidate) }
        let named = pickNamedType { isWrong(.named($0)) }
        if choices.percent(50), let named { return .named(named) }
        var candidates: [TypeScriptType] = [.number, .string, .boolean, .bigint, .array(.number), .array(.string)]
        if case .array(let element) = type { candidates += [.array(falsify(element)), .tuple([element]), .tuple([element, .string])] }
        if type.arms.contains(where: \.isNullish) { candidates += [type.withoutNullish, type.withoutNullish] }
        candidates.removeAll { !isWrong($0) }
        guard !candidates.isEmpty else { return type == .number ? .string : .number }
        return choices.pick(candidates)
    }

    /// The type to write at a declaration of something that has the given type, or nothing.
    private func chooseAnnotation(for right: TypeScriptType) -> TypeScriptType? {
        switch chooseTruth() {
        case .absent: return nil
        case .right: return right
        case .wider: return widen(right)
        case .wrong:
            let isNarrow = choices.percent(25)
            return isNarrow ? narrow(right) ?? falsify(right) : falsify(right)
        }
    }

    /// A few of the values of a primitive.
    private func narrow(_ type: TypeScriptType) -> TypeScriptType? {
        switch type {
        case .number: return .literals(choices.pick(["0 | 1", "1 | 2 | 3", "-1 | 0 | 1", "1 | 2 | 4 | 8", "0.5 | 1.5", "4294967296 | -4294967296"]), .number)
        case .string: return .literals(choices.pick(["\"a\" | \"b\"", "\"\"", "\"number\" | \"string\" | \"object\"", "`a${string}`"]), .string)
        case .boolean: return .literals(choices.pick(["true", "false"]), .boolean)
        default: return nil
        }
    }

    // MARK: What the checker accepts

    private func assignable(_ aliasedSource: TypeScriptType, to aliasedTarget: TypeScriptType) -> Bool {
        let (source, target) = (aliasedSource.plain, aliasedTarget.plain)
        if source == target || target == .any || target == .unknown || source == .any { return source != .untracked }
        switch (source, target) {
        case (.untracked, _), (_, .untracked), (.unknown, _): return false
        case (.literals(_, let base), _): return !aliasedTarget.mentionsEnumeration && assignable(base, to: target)
        case (.library, .object): return true
        case (.union(let arms), _): return arms.allSatisfy { assignable($0, to: target) }
        case (_, .union(let arms)): return arms.contains { assignable(source, to: $0) }
        case (.int32, .number), (.undefined, .void): return true
        case (.named(let name), .named):
            return baseOf[name].map { assignable(.named($0), to: target) } ?? false
        case (.named(let name), .object) where name.hasPrefix("T") && name.dropFirst().allSatisfy(\.isNumber):
            return false
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
            if let member = members[owner]?[name] ?? baseOf[owner].flatMap({ member(name, of: .named($0)) }) { return member }
            if Self.typedArrays[owner] != nil, ["length", "byteLength", "byteOffset"].contains(name) {
                return Member(type: .number, isReadonly: true)
            }
            return indexed.contains(owner) && methods[owner]?[name] == nil ? Member(type: .any) : nil
        case .string, .array, .readonlyArray, .tuple:
            return name == "length" ? Member(type: .number, isReadonly: true) : nil
        case .generic("Map", _), .generic("Set", _):
            return name == "size" ? Member(type: .number, isReadonly: true) : nil
        case .library(let owner):
            return Self.libraryConstants["\(owner).\(name)"].map { Member(type: $0, isReadonly: true) }
        default:
            return nil
        }
    }

    private func isArray(_ type: TypeScriptType) -> Bool {
        if case .array = type { return true }
        return false
    }

    // MARK: The declared types

    /// How an object type is written. All of them mean the same members.
    private enum Spelling: CaseIterable { case interface, alias, mapped, picked, omitted, withDefault }
    private enum BaseSpelling: CaseIterable { case interface, genericInterface, intersection }

    private var spellings = [String: Spelling]()
    private var baseSpellings = [String: BaseSpelling]()
    private var declarationOrder = [String]()
    private var genericFields = [String: String]()
    private var fieldModifiers = [Int: String]()
    private var parameterModifiers = [String: String]()
    private var implementsClauses = [Variable: String]()
    /// The object types that have `[key: string]: any`.
    private var indexed = Set<String>()
    private var namesWithWholeNumbers = Set<String>()
    private var fieldsWithValues = [Variable: Set<String>]()

    private func declareTypes() {
        let groups = nameOfGroup.keys.sorted { (nameOfGroup[$0]!.count, nameOfGroup[$0]!) < (nameOfGroup[$1]!.count, nameOfGroup[$1]!) }
        for group in groups {
            let site = siteOfGroup[group]!
            interfaceOrder.append(nameOfGroup[group]!)
            placeOfName[nameOfGroup[group]!] = mix(seeds[site], places[site])
        }
        findBaseClasses()
        for group in groups {
            let name = nameOfGroup[group]!
            let place = placeOfName[name]!
            func choose(for member: String) { choices = ChoiceGenerator(state: mix(place, member.utf8)) }
            var table = [String: Member]()
            var fields: Set<String>? = nil
            if let owner = classOfGroup[group] {
                fields = fieldsOfClass[owner] ?? []
                if case .beginClassDefinition(let op) = definition(of: owner)?.op.opcode, op.hasSuperclass, baseOf[name] == nil { fields = [] }
            }
            for (property, type) in memberTypes[group] ?? [] where fields?.contains(property) ?? true {
                choose(for: property)
                var member = Member(type: translate(type))
                if let later = propertiesStoredLater[group]?[property] { member.type = .union(of: [member.type, translate(later)]) }
                switch chooseTruth() {
                case .absent, .right: break
                case .wider: member.type = widen(member.type)
                case .wrong: member.type = falsify(member.type)
                }
                member.isOptional = propertiesDeleted[group]?.contains(property) ?? false
                member.isReadonly = propertiesStoredLater[group]?[property] == nil && choices.percent(15)
                let canBeWhole = classOfGroup[group].map { fieldsWithValues[$0]?.contains(property) ?? false } ?? true
                if choices.percent(settings.int32), member.type == .number, canBeWhole, !member.isOptional, acceptance == .casts {
                    member.type = .int32
                    namesWithWholeNumbers.insert(name)
                }
                table[property] = member
            }
            guard classOfGroup[group] == nil else {
                members[name] = table
                // One field can have the type of a type parameter of the class, whose default is the field's type.
                choose(for: " type parameter")
                if choices.percent(settings.generic), acceptance == .casts,
                    let field = table.keys.sorted().first(where: { !table[$0]!.type.text.contains(name) && table[$0]!.type != .int32 })
                {
                    genericFields[name] = field
                }
                continue
            }

            for (property, type) in (propertiesStoredLater[group] ?? [:]).sorted(by: { $0.key < $1.key }) where table[property] == nil {
                table[property] = Member(type: translate(type), isOptional: true)
            }
            let methodNames = groupTypes[group]?.methods ?? []
            for method in methodNames where table[method] == nil {
                methods[name, default: [:]][method] = Callable(
                    parameters: [.init(name: "values", type: .array(.any), isRest: true)], result: .any)
            }
            // Members that the literal doesn't have. Other code can store them.
            for extra in ["a", "b", "c", "next", "value", "neverStored"] where table[extra] == nil && !methodNames.contains(extra) {
                choose(for: "optional \(extra)")
                guard choices.percent(7) else { continue }
                let own = TypeScriptType.named(name)
                let other = pickNamedType().map(TypeScriptType.named) ?? own
                table[extra] = Member(
                    type: choices.pick([own, own, other, .union(of: [own, .null]), .array(own), .number, .string, .function([], own)]),
                    isOptional: true)
            }

            choose(for: " spelling")
            let isIndexed = choices.percent(10)
            let hasBase = choices.percent(35) && !isIndexed
            let hasRoot = choices.percent(30)
            spellings[name] = isIndexed ? .interface : choices.pick(Spelling.allCases + [.interface, .interface])
            if isIndexed { indexed.insert(name) }
            baseSpellings[name] = choices.pick(BaseSpelling.allCases)
            func split(_ whole: [String: Member], _ salt: UInt64) -> (inherited: [String: Member], own: [String: Member]) {
                let inherited = whole.filter { mix(mix(place, salt), $0.key.utf8) % 2 == 0 }
                return (inherited, whole.filter { inherited[$0.key] == nil })
            }
            if hasBase, case let (inherited, own) = split(table, 2), !inherited.isEmpty {
                let base = "\(name)Base"
                table = own
                baseOf[name] = base
                members[base] = inherited
                if hasRoot, case let (oldest, rest) = split(inherited, 3), !oldest.isEmpty {
                    baseOf[base] = "\(name)Root"
                    members["\(name)Root"] = oldest
                    members[base] = rest
                    declarationOrder.append("\(name)Root")
                }
                declarationOrder.append(base)
            }
            declarationOrder.append(name)
            members[name] = table
        }
        for name in declarationOrder where placeOfName[name] == nil {
            placeOfName[name] = mix(0, name.utf8)
            interfaceOrder.append(name)
        }
    }

    /// The classes that can name their base class as it is: the base is a class that the plan follows, and a
    /// constructor starts with the call of the base's.
    private func findBaseClasses() {
        for (group, owner) in classOfGroup.sorted(by: { $0.value.number < $1.value.number }) {
            guard let begin = indexOfDefinition[owner], case .beginClassDefinition(let op) = code[begin].op.opcode, op.hasSuperclass,
                let name = nameOfGroup[group]
            else { continue }
            let base = code[begin].input(0)
            guard !reassigned.contains(base), classOfGroup.values.contains(base), let baseHead = definition(of: base),
                baseHead.numInputs == 0 || baseOf["C\(base.number)"] != nil
            else { continue }
            if let constructor = constructorOfClass[base], let head = code[constructor].op as? BeginAnySubroutine,
                !head.parameters.destructuringParameters.isEmpty
            {
                continue
            }
            if let constructor = constructorOfClass[owner] {
                guard let first = code[(constructor + 1)...].first(where: { !$0.isNop }), first.op is CallSuperConstructor,
                    !first.inputs.contains(code[constructor].innerOutput(0))
                else { continue }
            }
            baseOf[name] = "C\(base.number)"
        }
    }

    private func write(_ table: [String: Member], replacing replaced: [String: String] = [:]) -> [String] {
        table.sorted(by: { $0.key < $1.key }).map { key, member in
            "    \(member.isReadonly ? "readonly " : "")\(propertyKey(key))\(member.isOptional ? "?" : ""): \(replaced[key] ?? member.type.text);"
        }
    }

    /// The declaration of an object type.
    private func declaration(of name: String) -> String {
        let table = members[name] ?? [:]
        var fields = write(table)
        fields += (methods[name] ?? [:]).keys.sorted().map { "    \(propertyKey($0))(...values: any[]): any;" }
        if indexed.contains(name) { fields.append("    [key: string]: any;") }
        let body = "{\n\(fields.joined(separator: "\n"))\n}"
        let owner = name.hasSuffix("Base") ? String(name.dropLast(4)) : name
        /// The members whose types become type parameters.
        func parameters(of table: [String: Member]) -> [String] {
            table.keys.sorted().filter { table[$0]!.type.text.range(of: "O[0-9]", options: .regularExpression) == nil }.prefix(3).map { $0 }
        }

        if name.hasSuffix("Base"), baseSpellings[owner] == .genericInterface, baseOf[name] == nil {
            let generic = parameters(of: table)
            guard !generic.isEmpty else { return "interface \(name) \(body)" }
            let head = generic.enumerated().map { "T\($0.offset) = \(table[$0.element]!.type.text)" }.joined(separator: ", ")
            let replaced = Dictionary(uniqueKeysWithValues: generic.enumerated().map { ($0.element, "T\($0.offset)") })
            return "interface \(name)<\(head)> {\n\(write(table, replacing: replaced).joined(separator: "\n"))\n}"
        }
        if let base = baseOf[name] {
            switch baseSpellings[name] {
            case .intersection?:
                return "type \(name) = \(base) & \(body);"
            case .genericInterface? where baseOf[base] == nil:
                let inherited = members[base] ?? [:]
                let arguments = parameters(of: inherited).map { inherited[$0]!.type.text }
                return "interface \(name) extends \(base)\(arguments.isEmpty ? "" : "<\(arguments.joined(separator: ", "))>") \(body)"
            default:
                return "interface \(name) extends \(base) \(body)"
            }
        }
        let keys = (Array(table.keys) + Array((methods[name] ?? [:]).keys)).sorted().map { Int($0) == nil ? "\"\($0)\"" : $0 }.joined(separator: " | ")
        let larger = "{\n\((fields + ["    leftOut: string;"]).joined(separator: "\n"))\n}"
        switch spellings[name] {
        case .alias?:
            return "type \(name) = \(body);"
        case .mapped?:
            return "interface \(name)Shape \(body)\ntype \(name) = { [K in keyof \(name)Shape]: \(name)Shape[K] };"
        case .picked? where !keys.isEmpty:
            return "interface \(name)All \(larger)\ntype \(name) = Pick<\(name)All, \(keys)>;"
        case .omitted?:
            return "interface \(name)All \(larger)\ntype \(name) = Omit<\(name)All, \"leftOut\">;"
        case .withDefault?:
            guard let first = parameters(of: table).first else { fallthrough }
            let rest = write(table, replacing: [first: "T"]) + fields.dropFirst(table.count)
            return "interface \(name)<T = \(table[first]!.type.text)> {\n\(rest.joined(separator: "\n"))\n}"
        default:
            return "interface \(name) \(body)"
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
        var subroutines = [OpenSubroutine]()
        var openClasses = [Variable]()
        /// Whether the checker knows what `super` has in each of the open classes.
        var checkedBases = [Bool]()
        /// The type that the checker takes each of the open object literals for.
        var openLiterals = [String?]()

        for instr in code {
            if instr.op is EndCodeString { codeStringDepth -= 1 }
            defer { if instr.op is BeginCodeString { codeStringDepth += 1 } }
            if codeStringDepth > 0 { continue }

            let index = instr.index
            choose(at: index)
            func convert(_ i: Int, _ conversion: Conversion) { inputConversions[index, default: [:]][i] = conversion }
            func canConvert(_ i: Int) -> Bool { !instr.reassigns(instr.input(i)) && !isLabel(instr.input(i)) }
            /// Makes the checker accept the instruction whatever its inputs are. Returns whether it does so by ignoring the line.
            @discardableResult
            func giveUp(from first: Int = 0) -> Bool {
                let convertible = (first..<instr.numInputs).filter(canConvert)
                let namesBuiltin = instr.numInputs > 0 && code[indexOfDefinition[instr.input(0)] ?? 0].op is CreateNamedVariable
                // Ignoring a line doesn't take away what the build asks of an `int32`.
                let storesWholeNumbers = instr.inputs.contains {
                    func takesWholeNumbers(_ callable: Callable) -> Bool { callable.parameters.contains { $0.type == .int32 } }
                    switch type(of: $0).plain {
                    case .named(let name):
                        if namesWithWholeNumbers.contains(name) || (methods[name] ?? [:]).values.contains(where: takesWholeNumbers) { return true }
                    case .classOf(let name):
                        if constructors[name].map(takesWholeNumbers) ?? false { return true }
                    default:
                        break
                    }
                    return callables[$0].map(takesWholeNumbers) ?? false
                }
                if let i = convertible.first, !instr.isBlock, choices.percent(settings.ignoredLine * (namesBuiltin ? 2 : 1)),
                    !storesWholeNumbers
                {
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
                // A store to a member of a literal is written with a variable for the literal.
                if instr.op is SetProperty || instr.op is UpdateProperty, isWrittenAsLiteral(instr.input(0)) { pinned.insert(instr.input(0)) }
                // The result of a guarded operation is declared in front of it, without a value.
                if instr.isGuarded {
                    for v in instr.outputs where annotations[v] == nil { declared[v] = .untracked }
                }
                // Fuzzilli writes `this` for the receiver of an outer function too, where it means the inner one's.
                for (i, v) in instr.inputs.enumerated() where acceptance == .casts {
                    if let owner = indexOfDefinition[v], code[owner].op is BeginAnySubroutine, code[owner].numInnerOutputs > 0,
                        code[owner].innerOutput(0) == v, !(code[owner].op is BeginAnyFunction), owner != subroutines.last?.begin,
                        inputConversions[index]?[i] == nil
                    {
                        convert(i, .toAny)
                    }
                }
            }
            /// Makes an input fit a position of the given type.
            func pass(_ i: Int, into target: TypeScriptType) {
                if target == .int32 {
                    if !isSmallWholeNumber(instr.input(i)) { convert(i, .wholeNumber) }
                } else if !assignable(type(of: instr.input(i)), to: target)
                    || (target.mentionsEnumeration && isWrittenAsNumber(instr.input(i)))
                {
                    convert(i, .toAny)
                }
            }
            /// Writes an array as a constant now and then.
            func makeConstant() -> Bool {
                guard !reassigned.contains(instr.output), choices.percent(8) else { return false }
                outputConversions[instr.output] = .asConstant
                pinned.insert(instr.output)
                declared[instr.output] = .untracked
                return true
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
            func inputIsLiteral(_ i: Int) -> Bool { literals.contains(instr.input(i)) || isWrittenAsLiteral(instr.input(i)) }
            /// A condition that the checker can see through is an error.
            func passCondition(_ i: Int) {
                switch type(of: instr.input(i)) {
                case .number, .int32, .string, .boolean, .bigint, .any, .union:
                    if inputIsLiteral(i) { convert(i, .toAny) }
                default: convert(i, .toAny)
                }
            }

            if acceptance != .casts {
                produceWithoutChecking(instr, &classNames)
                continue
            }

            switch instr.op.opcode {
            case .loadInteger(let op):
                if !reassigned.contains(instr.output), op.value.magnitude < 1 << 29, choices.percent(12) {
                    let name = "N\(op.value < 0 ? "_" : "")\(op.value.magnitude)"
                    let n = op.value
                    var spellings = ["\(n)", "\(n)", "\(n - 1) + 1", "\(n) | 0", "~~\(n)", "-(\(-n))", "\(n * 2) >> 1", "\(n) * 1"]
                    if !enumsAreConstant { spellings += ["\"x\".length + \(n - 1)", "Math.trunc(\(n))", "[\(n)][0]"] }
                    enumMembers[name] = choices.pick(spellings)
                    outputConversions[instr.output] = .replaced("Numbers.\(name)")
                }
                produce(instr.output, .number, isLiteral: true)
            case .loadFloat:
                produce(instr.output, .number, isLiteral: true)
            case .loadString(let op):
                if !reassigned.contains(instr.output), (1...12).contains(op.value.count), choices.percent(12),
                    op.value.utf8.allSatisfy({ ($0 >= 97 && $0 <= 122) || ($0 >= 65 && $0 <= 90) })
                {
                    textMembers["T_\(op.value)"] = "\"\(op.value)\""
                    outputConversions[instr.output] = .replaced("Texts.T_\(op.value)")
                }
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
                if !makeConstant() { produce(instr.output, .array(.number)) }
            case .createArray:
                if makeConstant() { break }
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
                if !sameKind || (!isOrdering && (inputIsLiteral(0) || inputIsLiteral(1) || a.isLiterals || b.isLiterals)) {
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
                if let member = member(op.propertyName, of: type(of: instr.input(0))), !member.isReadonly, !member.isMethod {
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
                } else if !op.isCallOptional, case .library(let name) = type(of: instr.input(0)), let callable = Self.libraryFunctions[name],
                    passArguments(callable, from: 1)
                {
                    produce(instr.output, callable.result)
                } else {
                    produce(instr.output, .untracked, onIgnoredLine: giveUp())
                }

            case .construct:
                if case .classOf(let name) = type(of: instr.input(0)), let callable = constructors[name],
                    passArguments(callable, from: 1)
                {
                    if let field = genericFields[name], let member = members[name]?[field], choices.percent(50) {
                        convert(0, .replaced("\(name)<\(member.type.text)>"))
                    }
                    produce(instr.output, .named(name))
                } else if case .library(let name) = type(of: instr.input(0)), let callable = Self.libraryFunctions["new.\(name)"],
                    passArguments(callable, from: 1)
                {
                    produce(instr.output, callable.result)
                } else if case .library(let name) = type(of: instr.input(0)), name == "Map" || name == "Set", instr.numInputs == 1 {
                    func argument() -> TypeScriptType {
                        let named = pickNamedType().map(TypeScriptType.named) ?? .object
                        return choices.pick([.any, .string, .number, .number, named, .union(of: [.string, .number])])
                    }
                    let made = TypeScriptType.generic(name, name == "Map" ? [argument(), argument()] : [argument()])
                    convert(0, .replaced(made.text))
                    produce(instr.output, made)
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
                if !op.isReceiverOptional, type(of: instr.input(1)).isNumber, let element = indexedType(of: type(of: instr.input(0))) {
                    produce(instr.output, element)
                } else if !op.isReceiverOptional, type(of: instr.input(1)) == .string, case .named(let name) = type(of: instr.input(0)).plain,
                    indexed.contains(name)
                {
                    produce(instr.output, .any)
                } else {
                    produce(instr.output, .untracked, onIgnoredLine: giveUp())
                }

            case .setComputedProperty:
                if type(of: instr.input(1)).isNumber, case .array(let element) = type(of: instr.input(0)).plain {
                    pass(2, into: element)
                } else if type(of: instr.input(1)).isNumber, case .named(let name) = type(of: instr.input(0)).plain,
                    let element = Self.typedArrays[name]
                {
                    pass(2, into: element)
                } else if type(of: instr.input(1)) == .string, case .named(let name) = type(of: instr.input(0)).plain, indexed.contains(name) {
                    break
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
                let isFollowed =
                    op.declarationMode == .none && Self.followedLibrary.contains(op.variableName) && !reassigned.contains(instr.output)
                declared[instr.output] = isFollowed ? .library(op.variableName) : .untracked

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
                if let head = subroutines.last.map({ code[$0.begin].op }),
                    head is BeginClassConstructor || head is BeginClassSetter || head is BeginClassComputedSetter
                        || head is BeginObjectLiteralSetter || head is BeginObjectLiteralComputedSetter || head is BeginClassPrivateSetter
                {
                    convert(0, .ignoredLine)
                } else if let result = subroutines.last?.result {
                    pass(0, into: result)
                }

            case .yield(let op):
                if op.hasArgument, let yielded = subroutines.last?.yielded { pass(0, into: yielded) }
                declared[instr.output] = .any

            case .await:
                if case .generic("Promise", let arguments) = type(of: instr.input(0)).plain {
                    produce(instr.output, arguments[0])
                } else {
                    produce(instr.output, .untracked)
                }

            case .beginWhileLoopBody, .endDoWhileLoop:
                // What stands in front of the condition is separated from it by commas.
                if instr.numInputs > 0 { convert(0, .ignoredLine) }

            case .beginIf:
                if instr.numInputs > 0 { passCondition(0) }

            case .loadNewTarget:
                declared[instr.output] = .untracked
                outputConversions[instr.output] = .ignoredLine

            case .ternaryOperation:
                passCondition(0)
                produce(instr.output, .untracked)

            case .beginObjectLiteral:
                openLiterals.append(planLiteral(endingAt: end(ofBlockAt: index)))

            case .endClassDefinition:
                classNames.removeLast()
                openClasses.removeLast()
                checkedBases.removeLast()

            case .classAddComputedProperty:
                convert(0, .ignoredLine)

            case .getSuperProperty, .getComputedSuperProperty, .callSuperMethod:
                giveUp()
                declared[instr.output] = .untracked
                if checkedBases.last == true { outputConversions[instr.output] = .ignoredLine }

            case .setSuperProperty, .setComputedSuperProperty, .updateSuperProperty:
                if checkedBases.last == true { convert(0, .ignoredLine) } else { giveUp() }

            case .callSuperConstructor:
                if let name = classNames.last ?? nil, let base = baseOf[name], let callable = constructors[base],
                    passArguments(callable, from: 0)
                {
                    break
                }
                giveUp()
                ignoredHeads.insert(index)

            case .objectLiteralAddProperty(let op):
                let end = enclosingLiteral(of: index)
                if end >= 0, repeatedKeys(ofLiteralEndingAt: end).contains(op.propertyName) {
                    convert(0, .ignoredLine)
                } else if let name = openLiterals.last ?? nil {
                    if let member = member(op.propertyName, of: .named(name)) {
                        pass(0, into: member.type)
                    } else {
                        convert(0, .ignoredLine)
                    }
                }

            case .objectLiteralAddElement, .objectLiteralSetPrototype:
                if (openLiterals.last ?? nil) != nil { convert(0, .ignoredLine) } else { giveUp() }

            case .objectLiteralAddComputedProperty, .objectLiteralCopyProperties:
                for i in 0..<instr.numInputs { convert(i, .toAny) }

            case .endObjectLiteral:
                openLiterals.removeLast()

            case .beginObjectLiteralMethod, .beginObjectLiteralComputedMethod, .beginObjectLiteralGetter,
                .beginObjectLiteralComputedGetter, .beginObjectLiteralSetter, .beginObjectLiteralComputedSetter:
                giveUp()
                ignoredHeads.insert(index)
                _ = beginSubroutine(instr, parameters: instr.innerOutputs.dropFirst(), returns: returns(of: instr.op))
                declared[instr.innerOutput(0)] = (openLiterals.last ?? nil).map(TypeScriptType.named) ?? .untracked
                let isGetter = instr.op is BeginObjectLiteralGetter || instr.op is BeginObjectLiteralComputedGetter
                subroutines.append(
                    OpenSubroutine(begin: index, result: bodyResults[index] ?? (isGetter ? .untracked : nil), yielded: yieldAnnotations[index]))

            case .beginClassGetter, .beginClassComputedGetter:
                giveUp()
                ignoredHeads.insert(index)
                _ = beginSubroutine(instr, parameters: instr.innerOutputs.dropFirst(), returns: .value)
                var isStatic = true
                if case .beginClassGetter(let op) = instr.op.opcode { isStatic = op.isStatic }
                let owner = (classNames.last ?? nil).flatMap { genericFields[$0] == nil ? $0 : nil }
                declared[instr.innerOutput(0)] = isStatic ? .untracked : owner.map(TypeScriptType.named) ?? .untracked
                subroutines.append(OpenSubroutine(begin: index, result: bodyResults[index] ?? .untracked))

            case .beginClassDefinition(let op):
                let ownName = "C\(instr.output.number)"
                let isFollowed = !op.isExpression && nameOfGroup.values.contains(ownName) && (!op.hasSuperclass || baseOf[ownName] != nil)
                classNames.append(isFollowed ? ownName : nil)
                openClasses.append(instr.output)
                checkedBases.append(!op.hasSuperclass || isFollowed)
                markRepeatedMembers(ofClassAt: index, named: ownName)
                if op.hasSuperclass {
                    if !isFollowed {
                        convert(0, .toAny)
                    } else if markInheritedMembers(ofClassAt: index, named: ownName) {
                        convert(0, .ignoredLine)
                    }
                }
                declared[instr.output] = isFollowed ? .classOf(ownName) : .untracked
                if isFollowed { prepareClass(ownName, instr.output) }
                let ownMembers = Set((memberSites[ownName] ?? [:]).keys.map { String($0.drop(while: { $0 != " " }).dropFirst()) })
                let implemented = pickNamedType { candidate in
                    candidate.hasPrefix("O") && !ownMembers.contains { member($0, of: .named(candidate)) != nil || method($0, of: candidate) != nil }
                }
                if choices.percent(10), !op.isExpression, let implemented {
                    implementsClauses[instr.output] = " \(Self.ignoredLineMarker)implements \(implemented)"
                }

            case .classAddProperty(let op):
                if !op.isStatic, let name = classNames.last ?? nil, let member = members[name]?[op.propertyName] {
                    var mark = op.hasValue ? (member.isOptional ? "?" : "") : (member.isOptional ? "?" : "!")
                    if !op.hasValue, choices.percent(25) {
                        fieldModifiers[index] = "declare "
                        if mark == "!" { mark = "" }
                    } else if choices.percent(25) {
                        fieldModifiers[index] = member.isReadonly ? "readonly " : "public "
                    }
                    let isGeneric = genericFields[name] == op.propertyName
                    fieldAnnotations[index, default: ""] += "\(mark): \(isGeneric ? "T" : member.type.text)"
                    if op.hasValue { pass(0, into: isGeneric ? .untracked : member.type) }
                } else if op.hasValue {
                    convert(0, .toAny)
                }

            case .beginPlainFunction, .beginArrowFunction, .beginGeneratorFunction, .beginAsyncFunction,
                .beginAsyncArrowFunction, .beginAsyncGeneratorFunction:
                giveUp()
                let callable = beginSubroutine(instr, parameters: instr.innerOutputs, returns: returns(of: instr.op))
                callables[instr.output] = callable
                declared[instr.output] =
                    callable.isTracked && callable.genericPosition == nil ? .function(callable.parameters, callable.result) : .untracked
                subroutines.append(OpenSubroutine(begin: index, result: bodyResults[index], yielded: yieldAnnotations[index]))

            case .beginClassConstructor:
                giveUp()
                if (classNames.last ?? nil) == nil { ignoredHeads.insert(index) }
                let callable = beginSubroutine(instr, parameters: instr.innerOutputs.dropFirst(), returns: .nothing)
                if let name = classNames.last ?? nil {
                    for parameter in callable.parameters where callable.isTracked && !parameter.isRest && choices.percent(15) {
                        parameterModifiers[parameter.name] = choices.pick(["public ", "readonly ", "private ", "protected "])
                    }
                    constructors[name] = callable
                    declared[instr.innerOutput(0)] = genericFields[name] == nil ? .named(name) : .untracked
                }
                subroutines.append(OpenSubroutine(begin: index))

            case .beginClassMethod(let op):
                giveUp()
                let callable = beginSubroutine(instr, parameters: instr.innerOutputs.dropFirst(), returns: returns(of: op))
                if let name = classNames.last ?? nil, !op.isStatic {
                    if !callable.returnsTypeParameter { methods[name, default: [:]][op.methodName] = callable }
                    declared[instr.innerOutput(0)] = genericFields[name] == nil ? .named(name) : .untracked
                }
                subroutines.append(OpenSubroutine(begin: index, result: bodyResults[index], yielded: yieldAnnotations[index]))

            default:
                if instr.op is BeginAnySubroutine {
                    subroutines.append(OpenSubroutine(begin: index))
                    if instr.op is BeginClassComputedMethod || instr.op is BeginClassComputedSetter { ignoredHeads.insert(index) }
                    if instr.op is BeginConstructor { declarationsThatCannotBeStoredTo.insert(instr.output) }
                } else if instr.op is EndAnySubroutine {
                    subroutines.removeLast()
                    break
                }
                giveUp()
                for v in instr.allOutputs { declared[v] = .untracked }
            }
        }
    }

    /// What `v[i]` gives.
    private func indexedType(of type: TypeScriptType) -> TypeScriptType? {
        if case .generic = type.plain { return nil }
        return elementType(of: type)
    }

    /// What a loop over the value gives.
    private func elementType(of type: TypeScriptType) -> TypeScriptType? {
        switch type.plain {
        case .array(let element), .readonlyArray(let element): return element
        case .generic("Generator", let arguments), .generic("Set", let arguments): return arguments[0]
        case .generic("Map", let arguments): return .tuple(arguments)
        case .named(let name): return Self.typedArrays[name]
        default: return nil
        }
    }

    /// Decides how an object literal is declared. Returns the type that the checker takes it for while it reads the members.
    private func planLiteral(endingAt end: Int) -> String? {
        let v = code[end].output
        declared[v] = .untracked
        guard let group = inferred[v]?.group, let name = nameOfGroup[group], repeatedKeys(ofLiteralEndingAt: end).isEmpty else { return nil }
        choose(at: end, for: 1)
        let right = TypeScriptType.named(name)
        let isDeclared = !literalsWithMoreThanProperties.contains(end) || choices.percent(60)
        let truth = chooseTruth()
        let form = choices.below(10)
        guard isDeclared else { return nil }
        func annotate(_ type: TypeScriptType) {
            annotations[v] = type
            declared[v] = type
        }
        pinned.insert(v)
        // What an accessor gives is compared with the member where the literal starts.
        defer {
            if literalsWithMoreThanProperties.contains(end) {
                if outputConversions[v] == nil { outputConversions[v] = .ignoredLine } else { literalsOnIgnoredLines.insert(v) }
            }
        }
        switch truth {
        case .absent:
            if form < 3, !reassigned.contains(v) { outputConversions[v] = .asConstant }
            return nil
        case .right:
            switch form {
            case 0:
                outputConversions[v] = .satisfies(right)
            case 1:
                outputConversions[v] = through(right)
                declared[v] = right
            case 2:
                outputConversions[v] = .satisfies(right)
                annotate(right)
            default:
                annotate(right)
            }
        case .wider:
            outputConversions[v] = through(right)
            annotate(widen(right))
        case .wrong:
            let wrong = falsify(right)
            if case .named(let other) = wrong, namesWithWholeNumbers.contains(other) { return nil }
            outputConversions[v] = form < 5 ? .toAny : .throughUnknown(wrong)
            annotate(wrong)
            return nil
        }
        return name
    }

    private var literalsOnIgnoredLines = Set<Variable>()

    private func through(_ type: TypeScriptType) -> Conversion {
        let helper = choices.pick(Self.detours.filter { !$0.hasSuffix("Predicate") })
        helpers.insert(helper)
        return .through(helper, type)
    }

    private struct OpenSubroutine {
        var begin: Int
        /// What `return` and `yield` have to fit, where the function says so.
        var result: TypeScriptType? = nil
        var yielded: TypeScriptType? = nil
    }

    /// What a call of a function gives.
    private enum Returns { case nothing, value, promise, generator, asyncGenerator }

    private func returns(of op: Operation) -> Returns {
        func returns(_ isAsync: Bool, _ isGenerator: Bool) -> Returns {
            isAsync ? (isGenerator ? .asyncGenerator : .promise) : (isGenerator ? .generator : .value)
        }
        switch op.opcode {
        case .beginAsyncFunction, .beginAsyncArrowFunction: return .promise
        case .beginGeneratorFunction: return .generator
        case .beginAsyncGeneratorFunction: return .asyncGenerator
        case .beginClassMethod(let op): return returns(op.isAsync, op.isGenerator)
        case .beginObjectLiteralMethod(let op): return returns(op.isAsync, op.isGenerator)
        case .beginObjectLiteralComputedMethod(let op): return returns(op.isAsync, op.isGenerator)
        case .beginObjectLiteralSetter, .beginObjectLiteralComputedSetter: return .nothing
        default: return .value
        }
    }

    private var bodyResults = [Int: TypeScriptType]()
    private var yieldAnnotations = [Int: TypeScriptType]()

    /// What the instructions of one kind in a function's own body are given.
    private func typeOfInputs(in begin: Int, where isWanted: (Instruction) -> Bool) -> TypeScriptType {
        var nested = 0
        var types = [TypeScriptType]()
        for i in (begin + 1)..<end(ofBlockAt: begin) {
            if code[i].op is EndAnySubroutine { nested -= 1 }
            if nested == 0, code[i].numInputs > 0, isWanted(code[i]) { types.append(rightType(of: code[i].input(0))) }
            if code[i].op is BeginAnySubroutine { nested += 1 }
        }
        return types.count > 4 ? .any : .union(of: types)
    }

    private static let typedArrays: [String: TypeScriptType] = [
        "Uint8Array": .number, "Int8Array": .number, "Uint16Array": .number, "Int16Array": .number, "Uint32Array": .number,
        "Int32Array": .number, "Float32Array": .number, "Float64Array": .number, "Uint8ClampedArray": .number,
        "BigInt64Array": .bigint, "BigUint64Array": .bigint,
    ]

    private static let libraryConstants: [String: TypeScriptType] = {
        var table = [String: TypeScriptType]()
        for name in ["PI", "E", "LN2", "LN10", "LOG2E", "LOG10E", "SQRT2", "SQRT1_2"] { table["Math.\(name)"] = .number }
        for name in ["MAX_SAFE_INTEGER", "MIN_SAFE_INTEGER", "MAX_VALUE", "MIN_VALUE", "EPSILON", "NaN", "POSITIVE_INFINITY", "NEGATIVE_INFINITY"] {
            table["Number.\(name)"] = .number
        }
        return table
    }()

    /// The functions of the library that the plan follows: `Math.abs`, `parseInt`, and `new.Date` for the constructor.
    private static let libraryFunctions: [String: Callable] = {
        var table = [String: Callable]()
        func add(_ names: String, _ required: [TypeScriptType], _ result: TypeScriptType, optional: [TypeScriptType] = [], rest: TypeScriptType? = nil) {
            var parameters = required.map { TypeScriptParameter(name: "p", type: $0) }
            parameters += optional.map { TypeScriptParameter(name: "p", type: $0, isOptional: true) }
            if let rest { parameters.append(TypeScriptParameter(name: "p", type: .array(rest), isRest: true)) }
            for name in names.split(separator: " ") { table[String(name)] = Callable(parameters: parameters, result: result) }
        }
        add(
            "Math.abs Math.floor Math.ceil Math.round Math.trunc Math.sign Math.sqrt Math.cbrt Math.exp Math.log Math.log2 Math.log10 "
                + "Math.sin Math.cos Math.tan Math.atan Math.fround Math.clz32 Math.expm1 Math.log1p Math.sinh Math.cosh Math.tanh",
            [.number], .number)
        add("Math.pow Math.atan2 Math.imul", [.number, .number], .number)
        add("Math.max Math.min Math.hypot", [], .number, rest: .number)
        add("Math.random Date.now", [], .number)
        add("Number.isInteger Number.isFinite Number.isNaN Number.isSafeInteger Array.isArray", [.unknown], .boolean)
        add("Number.parseFloat parseFloat", [.string], .number)
        add("Number.parseInt parseInt", [.string], .number, optional: [.number])
        add("isNaN isFinite", [.number], .boolean)
        add("Number", [], .number, optional: [.any])
        add("String", [], .string, optional: [.any])
        add("Boolean", [], .boolean, optional: [.any])
        add("String.fromCharCode String.fromCodePoint", [], .string, rest: .number)
        add("Object.keys Object.getOwnPropertyNames", [.object], .array(.string))
        add("Object.values", [.object], .array(.any))
        add("Object.is", [.any, .any], .boolean)
        add("Object.isFrozen Object.isSealed Object.isExtensible", [.any], .boolean)
        add("Object.getPrototypeOf", [.any], .any)
        add("JSON.stringify", [.any], .string)
        add("JSON.parse", [.string], .any)
        add("Symbol.for", [.string], .symbol)
        add("Symbol", [], .symbol, optional: [.union([.string, .number])])
        add("BigInt.asIntN BigInt.asUintN", [.number, .bigint], .bigint)
        add("Reflect.ownKeys", [.object], .array(.union([.string, .symbol])))
        add("Reflect.has", [.object, .union([.string, .number, .symbol])], .boolean)
        add("new.Date", [], .named("Date"), optional: [.union([.number, .string])])
        add("new.ArrayBuffer", [.number], .named("ArrayBuffer"))
        for name in ["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "EvalError", "URIError"] {
            add("new.\(name) \(name)", [], .named(name), optional: [.string])
        }
        for name in typedArrays.keys { add("new.\(name)", [], .named(name), optional: [.number]) }
        return table
    }()

    private static let followedLibrary: Set<String> = Set(
        libraryFunctions.keys.map { key in
            let parts = key.split(separator: ".")
            return String(parts[0] == "new" ? parts[1] : parts[0])
        } + ["Map", "Set"])

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
        case .library(let owner):
            return Self.libraryFunctions["\(owner).\(name)"]
        case .generic("Map", let arguments):
            let key: (TypeScriptType, optional: Bool, rest: Bool) = (arguments[0], false, false)
            switch name {
            case "get": return callable([key], .union(of: [arguments[1], .undefined]))
            case "set": return callable([key, (arguments[1], false, false)], receiver.plain)
            case "has", "delete": return callable([key], .boolean)
            case "clear": return callable([], .void)
            default: return nil
            }
        case .generic("Set", let arguments):
            let one: (TypeScriptType, optional: Bool, rest: Bool) = (arguments[0], false, false)
            switch name {
            case "add": return callable([one], receiver.plain)
            case "has", "delete": return callable([one], .boolean)
            case "clear": return callable([], .void)
            default: return nil
            }
        case .named(let owner):
            guard let element = Self.typedArrays[owner] else { return nil }
            let one: (TypeScriptType, optional: Bool, rest: Bool) = (element, false, false)
            switch name {
            case "fill": return callable([one, optionalIndex, optionalIndex], receiver.plain)
            case "at": return callable([index], .union(of: [element, .undefined]))
            case "includes": return callable([one], .boolean)
            case "indexOf", "lastIndexOf": return callable([one], .number)
            case "join": return callable([(.string, true, false)], .string)
            case "reverse", "sort": return callable([], receiver.plain)
            default: return nil
            }
        default:
            return nil
        }
    }

    private func isWrittenAsLiteral(_ v: Variable) -> Bool {
        guard annotations[v] == nil, let op = definition(of: v)?.op else { return false }
        return op is LoadInteger || op is LoadFloat || op is LoadString || op is LoadBoolean || op is LoadBigInt
    }

    private func isWrittenAsNumber(_ v: Variable) -> Bool {
        guard annotations[v] == nil, let op = definition(of: v)?.op else { return false }
        return op is LoadInteger || op is LoadFloat
    }

    private func isSmallWholeNumber(_ v: Variable) -> Bool {
        if type(of: v) == .int32 { return true }
        guard literals.contains(v), outputConversions[v] == nil, case .loadInteger(let op) = definition(of: v)?.op.opcode else { return false }
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
    private func markRepeatedMembers(ofClassAt begin: Int, named name: String) {
        var first = [String: Int]()
        defer { memberSites[name] = first }
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

    private var memberSites = [String: [String: Int]]()

    /// A member that a base class has too has to fit the one of the base. Returns whether that goes for a static one.
    private func markInheritedMembers(ofClassAt begin: Int, named name: String) -> Bool {
        var inherited = Set<String>()
        var base = baseOf[name]
        while let current = base {
            inherited.formUnion((memberSites[current] ?? [:]).keys)
            base = baseOf[current]
        }
        var hasStatic = false
        for (key, member) in memberSites[name] ?? [:] where inherited.contains(key) && !key.hasPrefix("#") {
            if key.hasPrefix("true ") { hasStatic = true }
            if code[member].op is ClassAddProperty { fieldAnnotations[member] = Self.ignoredLineMarker } else { ignoredHeads.insert(member) }
        }
        return hasStatic
    }

    /// A method can be called before the checker, or this plan, reaches its body.
    private func prepareClass(_ name: String, _ v: Variable) {
        guard constructorOfClass[v] == nil else { return }
        var inherited = baseOf[name].flatMap { constructors[$0] } ?? Callable(parameters: [], result: .named(name))
        inherited.result = .named(name)
        constructors[name] = inherited
    }

    /// Chooses the annotations of a function's parameters and of what it returns.
    private func beginSubroutine(_ instr: Instruction, parameters: ArraySlice<Variable>, returns: Returns) -> Callable {
        let canReturn = returns != .nothing
        guard let op = instr.op as? BeginAnySubroutine else { fatalError("Not the start of a function") }
        var callable = Callable(parameters: [], result: .untracked)
        let isSimple = op.parameters.destructuringParameters.isEmpty
        let fewest = fewestArguments[instr.index] ?? op.parameters.count
        var optional = false
        // One parameter can have the type of a type parameter, which the function can also return.
        let typeParameter = TypeScriptType.named("T\(instr.index)")
        let genericPosition =
            acceptance == .casts && canReturn && isSimple && !parameters.isEmpty && choices.percent(settings.generic + 15)
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
            if annotation == .number, !reassigned.contains(v), choices.percent(settings.int32), acceptance == .casts { annotation = .int32 }
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
            let right =
                returns == .value && resultTypes[instr.index] != nil
                ? translate(resultTypes[instr.index]!) : typeOfInputs(in: instr.index) { $0.op is Return }
            if var annotation = callable.genericPosition != nil && choices.percent(60) ? typeParameter : chooseAnnotation(for: right) {
                callable.returnsTypeParameter = annotation == typeParameter
                if !endsWithReturn(instr.index) { annotation = .union(of: [annotation, .undefined]) }
                if !containsReturn(instr.index) {
                    annotation = .void
                    callable.returnsTypeParameter = false
                }
                if annotation == .number, choices.percent(settings.int32), acceptance == .casts { annotation = .int32 }
                bodyResults[instr.index] = annotation
                switch returns {
                case .nothing, .value:
                    break
                case .promise:
                    annotation = .generic("Promise", [annotation])
                case .generator, .asyncGenerator:
                    let yielded = chooseAnnotation(for: typeOfInputs(in: instr.index) { $0.op is Yield }) ?? .any
                    yieldAnnotations[instr.index] = yielded
                    annotation = .generic(returns == .generator ? "Generator" : "AsyncGenerator", [yielded, annotation, .any])
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
        let fits = onIgnoredLine || (assignable(actual, to: annotation) && !(isLiteral && annotation.mentionsEnumeration))
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
        _ instr: Instruction, _ classNames: inout [String?]
    ) {
        switch instr.op.opcode {
        case .beginPlainFunction, .beginArrowFunction, .beginGeneratorFunction, .beginAsyncFunction, .beginAsyncArrowFunction,
            .beginAsyncGeneratorFunction:
            _ = beginSubroutine(instr, parameters: instr.innerOutputs, returns: returns(of: instr.op))
        case .beginClassConstructor:
            _ = beginSubroutine(instr, parameters: instr.innerOutputs.dropFirst(), returns: .nothing)
        case .beginClassMethod, .beginObjectLiteralMethod, .beginObjectLiteralComputedMethod, .beginObjectLiteralGetter,
            .beginObjectLiteralComputedGetter, .beginObjectLiteralSetter, .beginObjectLiteralComputedSetter, .beginClassGetter,
            .beginClassComputedGetter:
            _ = beginSubroutine(instr, parameters: instr.innerOutputs.dropFirst(), returns: returns(of: instr.op))
        case .beginObjectLiteral:
            _ = planLiteral(endingAt: end(ofBlockAt: instr.index))
        case .endObjectLiteral:
            break
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
        case .through(let name, let type): text = "\(name)<\(type.text)>(\(expression.text))"
        case .wholeNumber: text = "((\(e) as any) | 0)"
        case .asConstant: text = "(\(e) as const)"
        case .parsed(let type): text = "(JSON.parse(writeAsText(\(expression.text))) as \(type.text))"
        case .replaced(let replacement): return Expression(type: Identifier, text: replacement, numSubexpressions: 0)
        case .ignoredLine:
            text =
                expression.type === Identifier
                ? "\(Self.ignoredLineMarker)\(e)"
                : "(\(Self.ignoredLineMarker)\(expression.text)\(expression.characteristic == .pure ? "" : " as any"))"
        }
        let type = expression.characteristic == .pure ? Identifier : EffectfulBracketedExpression
        return Expression(type: type, text: text, numSubexpressions: 0)
    }

    /// What stands in front of the opening bracket of an object literal that takes several lines.
    func prefix(producing v: Variable) -> String {
        let marker = literalsOnIgnoredLines.contains(v) ? Self.ignoredLineMarker : ""
        switch outputConversions[v] {
        case .through(let name, let type)?: return "\(marker)\(name)<\(type.text)>("
        case .ignoredLine?: return Self.ignoredLineMarker
        default: return marker
        }
    }

    /// What stands behind the closing bracket of an object literal that takes several lines.
    func suffix(producing v: Variable) -> String {
        switch outputConversions[v] {
        case .through?: return ")"
        case .asConstant?: return " as const"
        case .toAny?: return " as any"
        case .to(let type)?: return " as \(type.text)"
        case .throughUnknown(let type)?: return " as unknown as \(type.text)"
        case .satisfies(let type)?: return " satisfies \(type.text)"
        default: return ""
        }
    }

    func fieldModifiers(at index: Int) -> String { fieldModifiers[index] ?? "" }
    func parameterModifiers(for name: String) -> String { parameterModifiers[name] ?? "" }
    func implementsClause(ofClass v: Variable) -> String { implementsClauses[v] ?? "" }

    /// What follows the name of a class where it is declared.
    func typeParameters(ofClass v: Variable) -> String {
        guard let field = genericFields["C\(v.number)"], let member = members["C\(v.number)"]?[field] else { return "" }
        return "<T = \(member.type.text)>"
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
        "passThroughPromiseType", "passThroughFilter", "passThroughReduce", "passThroughFind", "passThroughFlatMap", "passThroughFrom",
        "passThroughForEach", "passThroughSort", "passThroughSet", "passThroughRest", "passThroughPattern", "passThroughClosure",
        "passThroughGenerator", "passThroughAccessor", "passThroughRecord", "passThroughOptional", "passThroughTernary",
        "passThroughNamespace",
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
        "passThroughNamespace": """
            namespace Passing {
                export let count = 0;
                export function through<T>(value: T): T {
                    count++;
                    return value;
                }
            }
            function passThroughNamespace<T>(value: T): T { return Passing.through<T>(value); }
            """,
        "passThroughFilter": "function passThroughFilter<T>(value: T): T { return [value].filter((element: T): boolean => true)[0]; }",
        "passThroughReduce": "function passThroughReduce<T>(value: T): T { return [value].reduce((held: T, element: T): T => element, value); }",
        "passThroughFind": "function passThroughFind<T>(value: T): T { return [value].find((element: T): boolean => true) as T; }",
        "passThroughFlatMap": "function passThroughFlatMap<T>(value: T): T { return [value].flatMap((element: T): T[] => [element])[0]; }",
        "passThroughFrom": "function passThroughFrom<T>(value: T): T { return Array.from([value], (element: T): T => element)[0]; }",
        "passThroughForEach": """
            function passThroughForEach<T>(value: T): T {
                let held: T = value;
                [value].forEach((element: T): void => { held = element; });
                return held;
            }
            """,
        "passThroughSort": "function passThroughSort<T>(value: T): T { return [value, value].sort((first: T, second: T): number => 0)[1]; }",
        "passThroughSet": """
            function passThroughSet<T>(value: T): T {
                for (const element of new Set<T>([value])) return element;
                return value;
            }
            """,
        "passThroughRest": "function passThroughRest<T>(value: T): T { return ((...values: T[]): T => values[0])(...[value]); }",
        "passThroughPattern": """
            function passThroughPattern<T>(value: T): T {
                const { held }: { held: T } = { held: value };
                const [first]: [T] = [held];
                return first;
            }
            """,
        "passThroughClosure": """
            function passThroughClosure<T>(value: T): T {
                let held: T = value;
                const read = (): T => held;
                const write = (next: T): void => { held = next; };
                write(read());
                return read();
            }
            """,
        "passThroughGenerator": """
            function* yieldOnce<T>(value: T): Generator<T, void, unknown> { yield value; }
            function passThroughGenerator<T>(value: T): T {
                for (const element of yieldOnce<T>(value)) return element;
                return value;
            }
            """,
        "passThroughAccessor": """
            class Holder<T> {
                #held: T;
                constructor(held: T) { this.#held = held; }
                get value(): T { return this.#held; }
                set value(next: T) { this.#held = next; }
            }
            function passThroughAccessor<T>(value: T): T {
                const holder = new Holder<T>(value);
                holder.value = holder.value;
                return holder.value;
            }
            """,
        "passThroughRecord": """
            function passThroughRecord<T>(value: T): T {
                const record: Record<string, T> = {};
                record.key = value;
                return record["key"];
            }
            """,
        "passThroughOptional": """
            function passThroughOptional<T>(value: T): T {
                const holder: { held?: T } = {};
                holder.held = value;
                return holder.held as T;
            }
            """,
        "passThroughTernary": "function passThroughTernary<T>(value: T): T { return typeof value === \"object\" ? value : value; }",
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
        /// The name that a declaration over several lines at the top level declares.
        var openDeclaration: String? = nil
        lines = text.split(separator: "\n", omittingEmptySubsequences: false)
        for var line in lines {
            let indentation = line.prefix(while: { $0 == " " })
            // A program that ends early has printed what it had until then.
            defer {
                var finished: String? = nil
                if let name = Self.nameDeclared(by: line) {
                    if line.hasSuffix(";") { finished = name } else { openDeclaration = name }
                } else if indentation.isEmpty, line.hasPrefix("}"), let name = openDeclaration {
                    finished = name
                    openDeclaration = nil
                }
                if let finished {
                    if acceptance == .everyLineIgnored { body.append("// @ts-ignore") }
                    body.append("printValue(\"\(finished)\", \(finished));")
                }
            }
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

        if helpers.contains("passThroughList") { helpers.insert("Same") }
        var library = helpers.sorted().map { Self.helperDeclarations[$0]! }
        let declarations = declarationOrder.map(declaration(of:))
        if enumMembers.isEmpty, (body + declarations).contains(where: { $0.contains("Numbers") }) { enumMembers["N0"] = "0" }
        for (name, members) in [("Numbers", enumMembers), ("Texts", textMembers)] where !members.isEmpty {
            let list = members.sorted(by: { $0.key < $1.key }).map { "    \($0.key) = \($0.value)," }
            library.append("\(enumsAreConstant ? "const " : "")enum \(name) {\n\(list.joined(separator: "\n"))\n}")
        }

        let firstLines = acceptance == .uncheckedFile ? ["// @ts-nocheck"] : []
        func importOfInt32(for lines: [String]) -> [String] {
            lines.contains(where: { $0.contains("int32") }) ? ["import type { int32 } from \"bun\";"] : []
        }
        var head = firstLines + importOfInt32(for: usesInt32 ? ["int32"] : body + declarations)
        var otherFiles = ""
        if hasSeveralFiles {
            let classes = nameOfGroup.values.filter { $0.hasPrefix("C") }
            let typesCanMove = !declarations.contains { declaration in classes.contains { declaration.contains($0) } }
            var imports = [String]()
            if !library.isEmpty {
                let made = makeFile(named: "library", firstLines + importOfInt32(for: library), library)
                imports.append(made.import)
                otherFiles += made.file
            }
            if typesCanMove, !declarations.isEmpty {
                let made = makeFile(named: "types", firstLines + importOfInt32(for: declarations) + imports, declarations)
                imports.append(made.import)
                otherFiles += made.file
            }
            head += imports
            head.append("const printValue = console.log;")
            if !typesCanMove { head += declarations }
        } else {
            head.append("const printValue = console.log;")
            head += library + declarations
        }

        var tail = [String]()
        var printed = Set<String>()
        for line in lines {
            if let name = Self.nameDeclared(by: line), printed.insert(name).inserted {
                if acceptance == .everyLineIgnored { tail.append("// @ts-ignore") }
                tail.append("printValue(\"\(name)\", \(name));")
            }
        }
        tail.append("export {};")
        return (head + body + tail).joined(separator: "\n") + "\n" + otherFiles
    }

    /// The name that a line at the top level declares.
    private static func nameDeclared(by line: Substring) -> String? {
        for keyword in ["const ", "let ", "var ", "class ", "function ", "function* ", "async function ", "async function* "]
        where line.hasPrefix(keyword) {
            let name = String(line.dropFirst(keyword.count).prefix(while: { $0.isLetter || $0.isNumber || $0 == "_" || $0 == "$" }))
            return name.isEmpty ? nil : name
        }
        return nil
    }

    /// Writes declarations as a file of their own, behind a line with its name, and the import of everything in it.
    private func makeFile(named name: String, _ firstLines: [String], _ declarations: [String]) -> (file: String, import: String) {
        var values = [String]()
        var types = [String]()
        var lines = firstLines
        for line in declarations.flatMap({ $0.split(separator: "\n", omittingEmptySubsequences: false) }) {
            guard let keyword = ["function* ", "function ", "class ", "const enum ", "enum ", "namespace ", "type ", "interface "].first(where: { line.hasPrefix($0) })
            else {
                lines.append(String(line))
                continue
            }
            lines.append("export \(line)")
            let declared = String(line.dropFirst(keyword.count).prefix(while: { $0.isLetter || $0.isNumber || $0 == "_" }))
            if keyword == "type " || keyword == "interface " {
                if !types.contains(declared) { types.append(declared) }
            } else if !values.contains(declared) {
                values.append(declared)
            }
        }
        lines.append("export {};")
        let content = lines.joined(separator: "\n") + "\n"
        let path = "./\(name)-\(String(mix(0, content.utf8), radix: 36)).ts"
        let statement: String
        if seedOfProgram % 3 == 0 || values.isEmpty || types.isEmpty {
            statement = [
                values.isEmpty ? nil : "import { \(values.joined(separator: ", ")) } from \"\(path)\";",
                types.isEmpty ? nil : "import type { \(types.joined(separator: ", ")) } from \"\(path)\";",
            ].compactMap { $0 }.joined(separator: "\n")
        } else {
            statement = "import { \((values + types.map { "type \($0)" }).joined(separator: ", ")) } from \"\(path)\";"
        }
        return ("// @filename: \(path)\n\(content)", statement)
    }

    private func propertyKey(_ name: String) -> String {
        environment.isValidIdentifierOrIndex(name) ? name : "\"\(name)\""
    }
}

extension ILType {
    fileprivate var orAnything: ILType { self == .nothing ? .jsAnything : self }
}

// MARK: Programs that are refused whatever their types are

/// Throws for a program that stores to a built-in or to a member of one, that names a private member outside the class
/// that declares it or declares one twice, that calls `super()` in a class without a base class, or that has a regular
/// expression with the flag `v`, whose patterns Fuzzilli doesn't write.
func rejectProgramThatCannotBuild(_ program: Program, in environment: JavaScriptEnvironment) throws {
    var builtins = Set<Variable>()
    var privateNames = [Set<String>]()
    var classesHaveBases = [Bool]()
    func use(_ name: String) throws {
        guard privateNames.contains(where: { $0.contains(name) }) else {
            throw InternalError.postProcessRejection("a private name outside its class")
        }
    }
    for instr in program.code {
        for v in instr.inputs where builtins.contains(v) && instr.reassigns(v) {
            throw InternalError.postProcessRejection("a store to a built-in")
        }
        switch instr.op.opcode {
        case .setProperty, .updateProperty, .setElement, .updateElement, .setComputedProperty, .updateComputedProperty:
            if builtins.contains(instr.input(0)) { throw InternalError.postProcessRejection("a store to a member of a built-in") }
        case .callSuperConstructor:
            if classesHaveBases.last != true { throw InternalError.postProcessRejection("super() without a base class") }
        case .loadRegExp(let op):
            if op.flags.contains(.unicodeSets) { throw InternalError.postProcessRejection("a regular expression with the flag v") }
        case .createNamedVariable(let op):
            if op.declarationMode == .none, environment.builtins.contains(op.variableName) { builtins.insert(instr.output) }
        case .beginClassDefinition(let op):
            classesHaveBases.append(op.hasSuperclass)
            var names = Set<String>()
            var accessors = Set<String>()
            var depth = 0
            for member in program.code[(instr.index + 1)...] {
                if member.isBlockEnd {
                    if depth == 0 { break }
                    depth -= 1
                }
                if depth == 0 {
                    var name: String? = nil
                    switch member.op.opcode {
                    case .classAddPrivateProperty(let op): name = op.propertyName
                    case .beginClassPrivateMethod(let op): name = op.methodName
                    case .beginClassPrivateGetter(let op): accessors.insert(op.propertyName)
                    case .beginClassPrivateSetter(let op): accessors.insert(op.propertyName)
                    default: break
                    }
                    if let name, !names.insert(name).inserted { throw InternalError.postProcessRejection("a private name declared twice") }
                }
                if member.isBlockStart { depth += 1 }
            }
            privateNames.append(names.union(accessors))
        case .endClassDefinition:
            privateNames.removeLast()
            classesHaveBases.removeLast()
        case .getPrivateProperty(let op): try use(op.propertyName)
        case .setPrivateProperty(let op): try use(op.propertyName)
        case .updatePrivateProperty(let op): try use(op.propertyName)
        case .callPrivateMethod(let op): try use(op.methodName)
        default:
            break
        }
    }
}

// MARK: The seed of a program's types

/// Puts the string that seeds a program's types at its start. A program that has one keeps it, and with it the types of
/// everything that a mutation left as it was. Now and then the types of a part of the program are drawn again.
struct TypeScriptSeeds: FuzzingPostProcessor {
    func process(_ program: Program, for fuzzer: Fuzzer) throws -> Program {
        try rejectProgramThatCannotBuild(program, in: fuzzer.environment)
        let seeds = program.code.filter { TypeScriptPlan.seed(in: $0) != nil }.map(\.index)
        guard seeds.isEmpty || probability(0.15) else { return program }
        func makeSeed() -> String { "\(TypeScriptPlan.seedPrefix)\(UInt32.random(in: 0...UInt32.max))" }
        let replaced = seeds.count >= 4 || (!seeds.isEmpty && probability(0.3)) ? chooseUniform(from: seeds) : -1
        var position = seeds.isEmpty ? 0 : (replaced >= 0 ? Int.max : Int.random(in: 0..<program.size))

        let b = fuzzer.makeBuilder(forMutating: program)
        b.adopting {
            for instr in program.code {
                if instr.index >= position, b.context.contains(.javascript) {
                    b.loadString(makeSeed())
                    position = Int.max
                }
                if instr.index == replaced {
                    b.adopt(Instruction(LoadString(value: makeSeed()), inouts: instr.inouts))
                } else {
                    b.adopt(instr)
                }
            }
        }
        let result = b.finalize()
        result.contributors = program.contributors
        result.comments = program.comments
        return result
    }
}

// MARK: Shapes of programs

private func twoPropertyNames(_ b: ProgramBuilder) -> (String, String) {
    let first = b.randomCustomPropertyName()
    let second = b.randomCustomPropertyName()
    return (first, second == first ? "\(first)2" : second)
}

/// Generators for programs in which much depends on the declared types.
let typeScriptCodeGenerators: [(CodeGenerator, Int)] = [
    (CodeGenerator("ObjectThatHoldsItselfGenerator") { b in
        let handOn = b.buildPlainFunction(with: .parameters(n: 1)) { b.doReturn($0[0]) }
        let key = b.randomJsVariable()
        let (stored, read) = twoPropertyNames(b)
        let object = b.buildObjectLiteral { literal in
            literal.addProperty(stored, as: b.randomJsVariable())
            literal.addGetter(for: read) { this in
                b.setProperty(stored, of: this, to: this)
                b.build(n: 2)
                b.doReturn(b.callFunction(handOn, withArgs: [this]))
            }
            literal.addComputedGetter(for: key) { this in b.doReturn(b.callFunction(handOn, withArgs: [this])) }
            literal.addMethod(b.randomCustomMethodName(), with: .parameters(n: 1)) { arguments in
                b.setProperty(stored, of: arguments[0], to: arguments[1])
                b.doReturn(arguments[0])
            }
        }
        b.getProperty(stored, of: b.getProperty(read, of: object))
        b.getComputedProperty(key, of: object)
    }, 8),

    (CodeGenerator("CapturedVariableOfManyTypesGenerator") { b in
        let (name, _) = twoPropertyNames(b)
        let held = b.dup(b.buildObjectLiteral { $0.addProperty(name, as: b.randomJsVariable()) })
        let list = b.createArray(with: [])
        let read = b.buildArrowFunction(with: .parameters(n: 0)) { _ in b.doReturn(held) }
        let values = [
            b.loadInt(Int64.random(in: -3...300)), b.loadString(b.randomCustomPropertyName()), b.createArray(with: [held]),
            b.buildObjectLiteral { $0.addProperty(b.randomCustomPropertyName(), as: list) }, b.randomJsVariable(),
        ]
        b.buildRepeatLoop(n: Int.random(in: 2...20)) {
            b.reassign(variable: held, value: chooseUniform(from: values))
            b.updateComputedProperty(held, of: list, with: b.loadInt(1), using: chooseUniform(from: [.Add, .Exp, .NullCoalesce, .Mul]))
            let isObject = b.compare(b.typeof(held), with: b.loadString("object"), using: .strictEqual)
            b.ternary(isObject, b.loadString("object"), held)
            b.reassign(variable: held, value: chooseUniform(from: values))
            b.callFunction(read)
        }
    }, 8),

    (CodeGenerator("VariableComparedWithAnObjectGenerator") { b in
        let object = b.buildObjectLiteral { $0.addProperty(b.randomCustomPropertyName(), as: b.randomJsVariable()) }
        let list = b.createArray(with: [object])
        let table = b.buildObjectLiteral { _ in }
        let held = b.dup(chooseUniform(from: [b.loadInt(Int64.random(in: -3...300)), b.loadString(b.randomCustomPropertyName()), b.loadBool(true)]))
        b.buildRepeatLoop(n: Int.random(in: 2...10)) {
            b.reassign(variable: held, value: chooseUniform(from: [object, list, b.randomJsVariable()]))
            let isSame = b.compare(held, with: object, using: chooseUniform(from: [.strictEqual, .strictNotEqual]))
            b.buildIf(isSame) { b.setComputedProperty(held, of: table, to: held) }
            b.getComputedProperty(held, of: table)
            b.updateComputedProperty(held, of: table, with: b.loadInt(1), using: chooseUniform(from: [.Add, .Mul, .NullCoalesce]))
        }
    }, 8),

    (CodeGenerator("ClassWithBaseClassGenerator") { b in
        let (inherited, own) = twoPropertyNames(b)
        let method = b.randomCustomMethodName()
        let base = b.buildClassDefinition { definition in
            definition.addInstanceProperty(inherited, value: b.randomJsVariable())
            definition.addConstructor(with: .parameters(n: 1)) { b.setProperty(inherited, of: $0[0], to: $0[1]) }
            definition.addInstanceMethod(method, with: .parameters(n: 1)) { arguments in
                b.build(n: 2)
                b.doReturn(b.getProperty(inherited, of: arguments[0]))
            }
        }
        let derived = b.buildClassDefinition(withSuperclass: base) { definition in
            definition.addInstanceProperty(own, value: b.randomJsVariable())
            definition.addConstructor(with: .parameters(n: 2)) { arguments in
                b.callSuperConstructor(withArgs: [arguments[1]])
                b.setProperty(own, of: arguments[0], to: arguments[2])
            }
            if probability(0.5) {
                definition.addInstanceMethod(method, with: .parameters(n: 1)) { b.doReturn(b.callSuperMethod(method, withArgs: [$0[1]])) }
            }
            definition.addInstanceGetter(for: "\(own)Read") { this in b.doReturn(b.getProperty(inherited, of: this)) }
        }
        for constructor in [derived, base, derived] {
            let instance = b.construct(constructor, withArgs: b.randomJsVariables(n: 2))
            b.callMethod(method, on: instance, withArgs: [b.randomJsVariable()])
            b.setProperty(inherited, of: instance, to: b.randomJsVariable())
        }
    }, 8),

    (CodeGenerator("WholeNumbersInOperatorsGenerator") { b in
        let n = b.loadInt(chooseUniform(from: [-5, -1, 0, 1, 2, 7, 255, 65536, 536870911, -536870911]))
        let m = b.loadInt(chooseUniform(from: [0, 1, 2, 3, 31, 32]))
        b.binary(m, n, with: chooseUniform(from: BinaryOperator.allCases))
        b.unary(chooseUniform(from: [.Minus, .BitwiseNot, .Plus, .LogicalNot]), n)
        b.createTemplateString(from: ["", "", ""], interpolating: [n, m])
        let object = b.buildObjectLiteral { $0.addComputedProperty(n, as: m) }
        b.getComputedProperty(n, of: object)
        b.getComputedProperty(m, of: b.createArray(with: [n, m, n]))
    }, 8),
]
