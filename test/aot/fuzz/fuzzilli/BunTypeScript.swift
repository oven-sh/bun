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
    /// How often tests that narrow a declared type follow a declaration. Twice as often at the start of a function.
    var tested = 12
    /// How often what follows a declaration is a scene without a cast.
    var withoutCasts = 25
    /// How often a program is its scenes without a cast and nothing else.
    var scenesAlone = 0
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
            case "tested": settings.tested = value
            case "without-casts": settings.withoutCasts = value
            case "scenes-alone": settings.scenesAlone = value
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
    private var writtenHelpers = [String: String]()
    private var helpersThatNameTypes = [String: String]()
    private var testedParameters = [Int: [(name: String, type: TypeScriptType, isConstant: Bool)]]()
    private var sitesWithTests = 0
    /// The scenes of a program that is its scenes alone.
    private var scenesOfTheProgram = [String]()
    private var helpersOfTheScenes = Set<String>()
    private var variablesOfTheScenes = [String]()
    private var isScenesAlone = false
    /// The interfaces of a program can name its classes, which a program that is its scenes alone doesn't have.
    private var interfacesCanBeDeclared: Bool { !isScenesAlone || !nameOfGroup.values.contains { $0.hasPrefix("C") } }
    private var moduleVariables = [String]()
    private var sceneIsAsync = false
    private var isWithoutCasts = false
    private var depthOfSample = 0
    private var functionsAtTheTop = [String]()
    private var classesSoFar = [String]()
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
        // Fuzzilli tests its connection to the engine with programs that are one `eval`.
        isScenesAlone = Int(seedOfProgram / 11 % 100) < settings.scenesAlone && !code.contains { $0.op is Eval }
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
        guard interfacesCanBeDeclared else { return nil }
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
        let keys = (Array(table.keys) + Array((methods[name] ?? [:]).keys)).sorted().map { Int($0).map { $0 >= 0 } ?? false ? $0 : "\"\($0)\"" }.joined(separator: " | ")
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
            if let type = declared[v], annotation != typeParameter, !type.arms.contains(.int32),
                !(instr.op is BeginClassConstructor && isInDerivedClass(instr.index))
            {
                testedParameters[instr.index, default: []].append((name, type, !reassigned.contains(v)))
            }
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
        (testedParameters[index] == nil ? "" : "/*tests \(index)*/") + (genericHeads[index] == nil ? "" : "/*generic \(index)*/") + (ignoredHeads.contains(index) ? Self.ignoredLineMarker : "") + (returnAnnotations[index] == nil ? "" : "/*returns \(index)*/")
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
        "firstOf": "function firstOf<T>(list: T[]): T { return list[0]; }",
        "note": """
            let notes = 0;
            function note(value: unknown): void {
                if (notes++ < 80) console.log("noted", value instanceof Date ? "a date" : value);
            }
            """,
        "assert": """
            function assert(condition: unknown): asserts condition {
                if (!condition) throw new RangeError("It isn't so");
            }
            """,
        "assume": "function assume(condition: unknown): asserts condition {}",
        "Pile": """
            class Pile<T> {
                private items: T[] = [];
                add(item: T): this {
                    this.items.push(item);
                    return this;
                }
                top(): T { return this.items[this.items.length - 1]; }
                all(): readonly T[] { return this.items; }
                map<U>(change: (item: T) => U): Pile<U> {
                    const changed = new Pile<U>();
                    for (const item of this.items) changed.add(change(item));
                    return changed;
                }
            }
            """,
        "Source": """
            abstract class Source<T> {
                abstract next(): T;
                take(): T { return this.next(); }
            }
            class Fixed<T> extends Source<T> {
                constructor(private value: T) { super(); }
                next(): T { return this.value; }
            }
            """,
        "Lazy": """
            class Lazy<T> {
                #make: () => T;
                #made: { value: T } | undefined;
                constructor(make: () => T) { this.#make = make; }
                get value(): T { return (this.#made ??= { value: this.#make() }).value; }
            }
            """,
        "Watched": """
            function traced<This, Arguments extends any[], Result>(method: (this: This, ...given: Arguments) => Result, context: ClassMethodDecoratorContext) {
                return function (this: This, ...given: Arguments): Result { return method.call(this, ...given); };
            }
            function kept<This, Value>(field: undefined, context: ClassFieldDecoratorContext<This, Value>) {
                return (initial: Value): Value => initial;
            }
            class Watched<T> {
                @kept held: T;
                accessor seen: T;
                constructor(held: T) {
                    this.held = held;
                    this.seen = held;
                }
                @traced read(): T { return this.held; }
            }
            """,
        "shelf": """
            const shelf: { count: number; names: string[]; top: { held: number }; pairs: [number, string][] } = {
                count: 1,
                names: ["first", "second"],
                top: { held: 2 },
                pairs: [[1, "one"]],
            };
            function readShelf(): unknown[] {
                return [shelf.count + 1, shelf.names.length, shelf.names[0].length, shelf.top.held * 2, shelf.pairs[0][0] - 1, shelf.pairs[0][1].length];
            }
            """,
        "Link": "type Link<T> = { value: T; next: Link<T> | null };",
        "Outcome": "type Outcome<T> = { ok: true; value: T } | { ok: false; reason: string };",
        "pluck": "function pluck<T, K extends keyof T>(from: T, key: K): T[K] { return from[key]; }",
        "choose": "function choose<T>(first: T, second: T): T { return first === second ? second : first; }",
        "longest": "function longest<T extends { length: number }>(first: T, second: T): T { return first.length >= second.length ? first : second; }",
        "convert": """
            function convert(value: number): string;
            function convert(value: string): number;
            function convert(value: unknown): unknown { return value; }
            """,
        "Keeper": """
            class Keeper<T> {
                constructor(public held: T) {}
            }
            """,
        "Pretender": """
            class Pretender {
                held = 1;
                static [Symbol.hasInstance](value: unknown): boolean { return true; }
            }
            """,
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
        lines = addTests(to: text.split(separator: "\n", omittingEmptySubsequences: false))
        if isScenesAlone {
            lines = scenesOfTheProgram.map { Substring($0) }
            (helpers, moduleVariables) = (helpersOfTheScenes, variablesOfTheScenes)
            writtenHelpers = [:]
            if !interfacesCanBeDeclared { (enumMembers, textMembers) = ([:], [:]) }
        }
        // The time of the run is in what these print.
        let unsteady = Set(inferred.filter { $0.value.group == "Date" }.map { "v\($0.key.number)" })
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
                if let finished, !unsteady.contains(finished) {
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
        var library = helpers.sorted().map { Self.helperDeclarations[$0]! } + writtenHelpers.sorted { $0.key < $1.key }.map(\.value)
        let declarations =
            (interfacesCanBeDeclared ? declarationOrder.map(declaration(of:)) : []) + (isScenesAlone ? [] : helpersThatNameTypes.sorted { $0.key < $1.key }.map(\.value))
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
            var paths = [String]()
            let sharesHelpers = seedOfProgram % 3 == 0 && !helpers.isEmpty
            if sharesHelpers {
                // The file has every helper, so all programs that do this import the same file.
                let made = makeFile(named: "shared", firstLines, Self.helperDeclarations.keys.sorted().map { Self.helperDeclarations[$0]! })
                imports.append(made.import)
                otherFiles += made.file
                paths.append(made.path)
                library.removeFirst(helpers.count)
            }
            if !library.isEmpty {
                // Two files can import each other: one counts what is noted, the other one reads the count to say how much may be.
                let isCycle = !sharesHelpers && helpers.contains("note") && seedOfProgram % 5 < 2
                if isCycle { library = library.map { $0.replacingOccurrences(of: "notes++ < 80", with: "notes++ < limit()") } }
                let limits = "./limits-\(String(mix(0, (firstLines + library).joined(separator: "\n").utf8), radix: 36)).ts"
                let made = makeFile(
                    named: "library", firstLines + importOfInt32(for: library) + (isCycle ? ["import { limit } from \"\(limits)\";"] : []), library)
                imports.append(made.import)
                otherFiles += made.file
                paths.append(made.path)
                if isCycle {
                    otherFiles += "// @filename: \(limits)\n" + (firstLines + [
                        "import { notes } from \"\(made.path)\";", "export function limit(): number { return notes > 80 ? 0 : 80; }", "",
                    ]).joined(separator: "\n")
                }
            }
            if typesCanMove, !declarations.isEmpty {
                let made = makeFile(named: "types", firstLines + importOfInt32(for: declarations) + imports, declarations)
                imports.append(made.import)
                otherFiles += made.file
                paths.append(made.path)
            }
            if seedOfProgram % 7 < 2, !paths.isEmpty {
                // The program imports everything from a file that only hands on what the others export.
                let content = (firstLines + paths.map { "export * from \"\($0)\";" } + [""]).joined(separator: "\n")
                let index = "./index-\(String(mix(0, content.utf8), radix: 36)).ts"
                otherFiles += "// @filename: \(index)\n\(content)"
                for path in paths { imports = imports.map { $0.replacingOccurrences(of: "\"\(path)\"", with: "\"\(index)\"") } }
            }
            head += imports
            head.append("const printValue = console.log;")
            if !typesCanMove { head += declarations }
        } else {
            head.append("const printValue = console.log;")
            head += library + declarations
        }
        // Two scenes can follow one variable, at its declaration and at a store to it.
        var declaredVariables = Set<String>()
        head += moduleVariables.filter { declaredVariables.insert($0).inserted }
        if importsCommonFiles {
            let made = makeCommonFiles()
            head += made.head
            otherFiles += made.files
        }

        var tail = [String]()
        var printed = Set<String>()
        for line in lines {
            if let name = Self.nameDeclared(by: line), printed.insert(name).inserted, !unsteady.contains(name) {
                if acceptance == .everyLineIgnored { tail.append("// @ts-ignore") }
                tail.append("printValue(\"\(name)\", \(name));")
            }
        }
        if helpers.contains("note") {
            if acceptance == .everyLineIgnored { tail.append("// @ts-ignore") }
            tail.append("printValue(\"notes\", Math.min(notes, 80));")
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

    private var importsCommonFiles: Bool { hasSeveralFiles && seedOfProgram % 5 < 2 }

    /// Two files in CommonJS, and the lines of the program that import the first one and use it.
    private func makeCommonFiles() -> (files: String, head: [String]) {
        var choices = ChoiceGenerator(state: mix(seedOfProgram, 0xc75))
        var (exportsForm, importForm, needEachOther) = (choices.below(8), choices.below(6), choices.percent(50))
        if exportsForm == 6, importForm == 3 { importForm = 2 }
        // The text of both files follows from these two choices, and so do their names.
        let key = "\(exportsForm) \(needEachOther)"
        let common = "./common-\(String(mix(1, key.utf8), radix: 36)).cjs"
        let second = "./second-\(String(mix(2, key.utf8), radix: 36)).cjs"
        let names = ["double", "held", "count", "mode", "readSecond"]
        let list = names.joined(separator: ", ")
        var lines = [
            "console.log(\"loads common\");", "const second = require(\"\(second)\");", "function double(value) { return value + value; }",
            "const held = { count: 1, names: [\"a\"] };", "let calls = 0;", "function count() { return ++calls; }",
            "const mode = (function () { return typeof this; })();", "const readSecond = () => second.name;",
        ]
        switch exportsForm {
        case 0: lines += names.map { "exports.\($0) = \($0);" }
        case 1: lines.append("module.exports = { \(list) };")
        case 2: lines += names.map { "this.\($0) = \($0);" }
        case 3:
            lines += ["Object.defineProperty(exports, \"__esModule\", { value: true });", "exports.default = { \(list) };"]
            lines += names.map { "exports.\($0) = \($0);" }
        case 4:
            lines.append("module.exports = double;")
            lines += names.map { "module.exports.\($0) = \($0);" }
        case 5:
            lines.append("class Common {")
            lines += names.map { "    static \($0) = \($0);" }
            lines += ["}", "module.exports = Common;"]
        case 6: lines += names.map { "Object.defineProperty(exports, \"\($0)\", { enumerable: true, get() { return \($0); } });" }
        default: lines.append("for (const [key, value] of Object.entries({ \(list) })) exports[key] = value;")
        }
        var others = ["console.log(\"loads second\");", "exports.name = \"second\";"]
        if needEachOther {
            others += [
                "const common = require(\"\(common)\");", "exports.sawAtLoad = Object.keys(common).join();",
                "exports.readCommon = () => typeof common.double;",
            ]
        }
        let files = "// @filename: \(common)\n\(lines.joined(separator: "\n"))\n// @filename: \(second)\n\(others.joined(separator: "\n"))\n"
        var head = ["// @ts-ignore"]
        switch importForm {
        case 0: head += ["import common from \"\(common)\";", "const commonExports: any = common;"]
        case 1: head += ["import { \(list) } from \"\(common)\";", "const commonExports: any = { \(list) };"]
        case 2: head += ["import * as common from \"\(common)\";", "const commonExports: any = common;"]
        case 3: head += ["import common, { double } from \"\(common)\";", "const commonExports: any = common;", "printValue(\"double\", double === commonExports.double);"]
        case 4: head += ["const commonExports: any = require(\"\(common)\");"]
        default: head += ["const commonExports: any = await import(\"\(common)\");"]
        }
        for shown in [
            "Object.keys(commonExports).sort().join(), commonExports.mode, typeof commonExports.default",
            "commonExports.double(2), commonExports.double(\"a\"), commonExports.count(), commonExports.count(), commonExports.held",
            "commonExports.readSecond()",
        ] {
            head.append("try { printValue(\"common\", \(shown)); } catch (error) { printValue(\"threw\", (error as any)?.name); \(Self.messageToStderr) }")
        }
        return (files, head)
    }

    /// Writes declarations as a file of their own, behind a line with its name, and the import of everything in it.
    private func makeFile(named name: String, _ firstLines: [String], _ declarations: [String]) -> (file: String, import: String, path: String) {
        var values = [String]()
        var types = [String]()
        var lines = firstLines
        for line in declarations.flatMap({ $0.split(separator: "\n", omittingEmptySubsequences: false) }) {
            guard let keyword = ["function* ", "function ", "class ", "abstract class ", "let ", "const enum ", "const ", "enum ", "namespace ", "type ", "interface "].first(where: { line.hasPrefix($0) })
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
        return ("// @filename: \(path)\n\(content)", statement, path)
    }

    private func propertyKey(_ name: String) -> String {
        environment.isValidIdentifierOrIndex(name) ? name : "\"\(name)\""
    }
}

// MARK: Tests that narrow

extension TypeScriptPlan {
    /// What the checker takes a value for behind a test.
    private enum Narrowed {
        case never
        /// The plan can't tell.
        case unfollowed
        case type(TypeScriptType)
    }

    private struct Test {
        var condition: String
        var kept: Narrowed
        var rest: Narrowed
        /// The checker reports an error at the condition.
        var isRefused = false
        /// The plan may be mistaken about what is left.
        var isUnsure = false

        var negated: Test { Test(condition: "!(\(condition))", kept: rest, rest: kept, isRefused: isRefused, isUnsure: isUnsure) }
    }

    /// Something with a declared type that tests are written for.
    private struct Subject {
        var text: String
        var type: TypeScriptType
        /// Nothing is stored to it behind its declaration.
        var isConstant: Bool
        /// The instruction that declares it.
        var index: Int
    }

    private static let valuesOfEveryKind = [
        "undefined", "null", "0", "-0", "1.5", "NaN", "2147483648", "-1", "\"\"", "\"text\"", "\"7\"", "true", "false", "10n",
        "Symbol.iterator", "[]", "[1.5]", "[\"a\", 1]", "[, 1]", "{}", "{ a: 1 }", "{ length: 2 }", "{ kind: \"first\" }", "() => 1",
        "new Map()", "new Set([1])", "/x/g", "Object.create(null)", "new Proxy({}, {})", "new Uint8Array(2)",
        "new String(\"boxed\")", "new Number(3)", "class {}", "Promise.resolve(1)", "new Date(0)", "[[1], [2]]", "{ a: { a: 1 } }",
    ]

    /// What can be done with an object of the library. `$` stands for the object.
    private static let usesOfLibraryObjects: [String: [String]] = [
        "Map": ["$.size", "$.has(1)", "$.get(\"a\")", "[...$.keys()]"],
        "Set": ["$.size", "$.has(1)", "[...$]"],
        "RegExp": ["$.source", "$.flags", "$.lastIndex", "$.test(\"x\")"],
        "Error": ["$.message", "$.name"],
        "Promise": ["typeof $.then"],
        "Uint8Array": ["$.length", "$[0]", "$.byteLength", "$.subarray(1).length"],
        "String": ["$.length", "$.valueOf()", "$.charAt(0)"],
        "Number": ["$.valueOf()", "$.toFixed(1)"],
        "Pretender": ["$.held", "$.held + 1", "$.held.toFixed(1)", "($.held = 2)"],
    ]

    private static let guardedTypes: [(name: String, type: TypeScriptType, text: String, check: String)] = [
        ("Text", .string, "string", "typeof value === \"string\""),
        ("Number", .number, "number", "typeof value === \"number\""),
        ("Flag", .boolean, "boolean", "typeof value === \"boolean\""),
        ("BigNumber", .bigint, "bigint", "typeof value === \"bigint\""),
        ("Nothing", .union([.null, .undefined]), "null | undefined", "value == null"),
        ("List", .array(.unknown), "unknown[]", "Array.isArray(value)"),
    ]

    private func narrowed(_ arms: [TypeScriptType]) -> Narrowed { arms.isEmpty ? .never : .type(.union(of: arms)) }

    private func isFollowed(_ type: TypeScriptType) -> Bool { type != .any && type != .unknown && type != .untracked }

    private func allMembers(of name: String) -> [(name: String, member: Member)] {
        var table = [String: Member]()
        var owner: String? = name
        while let current = owner {
            for (key, member) in members[current] ?? [:] where table[key] == nil { table[key] = member }
            owner = baseOf[current]
        }
        return table.filter { parameterModifiers[$0.key] == nil }.sorted { $0.key < $1.key }.map { (name: $0.key, member: $0.value) }
    }

    private func read(_ name: String, of subject: String) -> String {
        let isIdentifier =
            name.first.map { $0.isLetter || $0 == "_" || $0 == "$" } == true
            && name.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "$") }
        return isIdentifier ? "\(subject).\(name)" : "\(subject)[\"\(name)\"]"
    }

    /// What `typeof` gives for every value of the type, where there is one answer.
    private func tag(of arm: TypeScriptType) -> String? {
        switch arm {
        case .literals(_, let base), .alias(_, let base): return tag(of: base)
        case .number, .int32: return "number"
        case .string: return "string"
        case .boolean: return "boolean"
        case .bigint: return "bigint"
        case .symbol: return "symbol"
        case .undefined: return "undefined"
        case .null, .array, .readonlyArray, .tuple: return "object"
        case .named(let name): return Self.typedArrays[name] != nil || !allMembers(of: name).isEmpty ? "object" : nil
        case .generic(let name, let arguments):
            if ["Map", "Set", "Promise", "Generator", "AsyncGenerator"].contains(name) { return "object" }
            return ["Readonly", "Partial"].contains(name) ? tag(of: arguments[0]) : nil
        case .function, .classOf: return "function"
        default: return nil
        }
    }

    private func primitive(for tag: String) -> TypeScriptType? {
        switch tag {
        case "string": return .string
        case "number": return .number
        case "boolean": return .boolean
        case "bigint": return .bigint
        case "symbol": return .symbol
        case "undefined": return .undefined
        default: return nil
        }
    }

    /// An expression that the checker accepts for a value of the type and for no other.
    private func use(_ s: String, as type: TypeScriptType, isShallow: Bool = false, depth: Int = 0) -> String {
        switch type {
        case .literals(_, let base): return use(s, as: base, isShallow: isShallow, depth: depth)
        case .alias(_, let aliased): return use(s, as: aliased, isShallow: true, depth: depth)
        case .generic("Readonly", let arguments), .generic("Partial", let arguments):
            return use(s, as: arguments[0], isShallow: true, depth: depth)
        case .number, .int32:
            return choices.pick([
                "\(s) + 1", "\(s) * 2", "\(s) - 1", "\(s) | 0", "\(s) >>> 1", "-\(s)", "\(s) % 3", "\(s) / 2", "\(s) < 3", "\(s) >= 0",
                "\(s).toFixed(1)", "Math.abs(\(s))", "Math.floor(\(s))", "Math.max(\(s), 2)", "\(s).toString(2)", "[10, 20, 30][\(s)]",
                "\"abc\".charAt(\(s))", "Number.isInteger(\(s))", "\(s) ** 2", "`${\(s)}`", "isNaN(\(s))", "\(s) & 255", "~\(s)",
                "\(s) << 2", "Math.imul(\(s), 3)", "Math.sqrt(\(s))", "\(s) + \(s)", "\(s) * \(s)", "new Array<number>(3).fill(\(s))",
            ])
        case .string:
            return choices.pick([
                "\(s).length", "\(s) + \"!\"", "\(s).charCodeAt(0)", "\(s).slice(1)", "\(s)[0]", "\(s).toUpperCase()",
                "\(s).indexOf(\"a\")", "`<${\(s)}>`", "\(s).split(\"\")", "\(s).padStart(3)", "\(s) < \"m\"", "\(s).at(-1)", "[...\(s)]",
                "\(s).trim().length", "\(s).concat(\(s))", "\(s).codePointAt(0)", "\(s).repeat(2)", "\(s).startsWith(\"a\")",
                "\(s).includes(\"1\")", "\(s) + \(s)", "\(s).replace(\"t\", \"d\")", "parseInt(\(s))", "\(s).substring(0, 1)",
            ])
        case .boolean:
            return choices.pick([
                "!\(s)", "\(s) ? 1 : 2", "\(s) && 3", "\(s) || 4", "Number(\(s))", "\(s).valueOf()", "\(s).toString()",
                "[\(s)].includes(true)",
            ])
        case .bigint:
            return choices.pick([
                "\(s) + 1n", "\(s) * 2n", "-\(s)", "\(s) > 0n", "BigInt.asIntN(8, \(s))", "\(s).toString()", "\(s) << 1n", "\(s) % 3n",
            ])
        case .symbol: return choices.pick(["\(s).description", "\(s).toString()", "typeof \(s)"])
        case .undefined, .null, .void: return choices.pick(["String(\(s))", "typeof \(s)", "[\(s)].length", "\(s) ?? \"nothing\""])
        case .named(let name):
            if let uses = Self.usesOfLibraryObjects[name] ?? (Self.typedArrays[name] == nil ? nil : Self.usesOfLibraryObjects["Uint8Array"]) {
                return choices.pick(uses).replacingOccurrences(of: "$", with: s)
            }
            let table = allMembers(of: name)
            guard !table.isEmpty else { return s }
            let (key, member) = choices.pick(table)
            let value = read(key, of: s)
            switch choices.below(isShallow || depth > 1 ? 4 : 8) {
            case 0: return "Object.keys(\(s)).length"
            case 1: return "({ ...\(s) })"
            case 2: return "\"\(key)\" in \(s)"
            case 3: return value
            case 4 where !member.isReadonly && !member.isMethod && member.type != .int32 && genericFields[name] != key:
                return "(\(value) = \(value))"
            default:
                if member.isMethod { return "typeof \(value)" }
                return member.isOptional ? "\(value) ?? \"absent\"" : use(value, as: member.type, depth: depth + 1)
            }
        case .array(let element), .readonlyArray(let element):
            var uses = [
                "\(s).length", "\(s)[0]", "\(s).at(-1)", "\(s).slice(0, 2)", "\(s).map(element => element)", "[...\(s)]",
                "\(s).indexOf(\(s)[0])", "\(s).join()", "\(s).includes(\(s)[0])", "Array.from(\(s)).length",
                "\(s).filter(() => true).length", "\(s).some(() => true)", "\(s).length > 0 ? \(s)[\(s).length - 1] : 0",
            ]
            if case .array = type, !isShallow { uses += ["\(s).push(\(s)[0])", "\(s).concat(\(s)).length", "\(s).reverse().length", "\(s).pop()"] }
            if depth < 2, !isShallow, isFollowed(element) { uses += [use("\(s)[0]", as: element, depth: depth + 1), use("\(s)[1]", as: element, depth: depth + 1)] }
            return choices.pick(uses)
        case .tuple(let elements):
            guard let first = elements.first, depth < 2 else { return "\(s).length" }
            let uses = ["\(s).length", "[...\(s)]", "\(s)[0]", use("\(s)[0]", as: first, depth: depth + 1)]
            return choices.pick(uses)
        case .generic(let name, _):
            guard let uses = Self.usesOfLibraryObjects[name] else { return s }
            return choices.pick(uses).replacingOccurrences(of: "$", with: s)
        case .function, .classOf: return choices.pick(["typeof \(s)", "\(s).length", "\(s).name"])
        case .object: return choices.pick(["Object.keys(\(s)).length", "typeof \(s)"])
        default: return s
        }
    }

    private func use(_ s: String, as narrowed: Narrowed) -> String {
        if case .type(let type) = narrowed { return use(s, as: type) }
        return s
    }

    // MARK: The tests

    private func testTypeof(_ s: String, _ type: TypeScriptType, _ wanted: String) -> Test {
        let condition = choices.pick(["typeof \(s) === \"\(wanted)\"", "\"\(wanted)\" === typeof \(s)", "typeof \(s) == \"\(wanted)\""])
        guard isFollowed(type) else {
            return Test(condition: condition, kept: primitive(for: wanted).map { .type($0) } ?? .unfollowed, rest: .unfollowed)
        }
        let tags = type.arms.map(tag(of:))
        guard !tags.contains(nil) else { return Test(condition: condition, kept: .unfollowed, rest: .unfollowed) }
        return Test(
            condition: condition, kept: narrowed(type.arms.filter { tag(of: $0) == wanted }),
            rest: narrowed(type.arms.filter { tag(of: $0) != wanted }))
    }

    private func testNothing(_ s: String, _ type: TypeScriptType) -> Test {
        let form = choices.below(3)
        let condition = ["\(s) === null", "\(s) === undefined", "\(s) == null"][form]
        guard isFollowed(type), !type.arms.map(tag(of:)).contains(nil) else {
            return Test(condition: condition, kept: .unfollowed, rest: .unfollowed)
        }
        func isKept(_ arm: TypeScriptType) -> Bool { (form != 1 && arm == .null) || (form != 0 && arm == .undefined) }
        return Test(condition: condition, kept: narrowed(type.arms.filter(isKept)), rest: narrowed(type.arms.filter { !isKept($0) }))
    }

    private func testTruth(_ s: String, _ type: TypeScriptType) -> Test {
        guard isFollowed(type), !type.arms.map(tag(of:)).contains(nil) else { return Test(condition: s, kept: .unfollowed, rest: .unfollowed) }
        let hasFewValues = type.arms.contains { $0.isLiterals || $0.mentionsEnumeration }
        let isAlwaysDefined = type.arms.allSatisfy {
            if case .generic("Promise", _) = $0 { return true }
            return tag(of: $0) == "function"
        }
        let primitives = ["number", "string", "boolean", "bigint", "undefined"]
        return Test(
            condition: s, kept: narrowed(type.arms.filter { !$0.isNullish }),
            rest: hasFewValues ? .unfollowed : narrowed(type.arms.filter { $0 == .null || primitives.contains(tag(of: $0)!) }),
            isRefused: isAlwaysDefined)
    }

    private func testValue(_ s: String, _ type: TypeScriptType) -> Test {
        let (text, base): (String, TypeScriptType) = choices.pick([
            ("0", .number), ("1", .number), ("-1", .number), ("1.5", .number), ("\"\"", .string), ("\"a\"", .string), ("\"text\"", .string),
            ("true", .boolean), ("false", .boolean), ("10n", .bigint),
        ])
        let condition = choices.pick(["\(s) === \(text)", "\(text) === \(s)", "\(s) == \(text)"])
        guard isFollowed(type), !type.arms.map(tag(of:)).contains(nil), !type.arms.contains(where: { $0.isLiterals || $0.mentionsEnumeration }) else {
            return Test(condition: condition, kept: .unfollowed, rest: .unfollowed, isRefused: isFollowed(type))
        }
        let overlaps = type.arms.contains { $0.plain == base || ($0.plain == .int32 && base == .number) }
        return Test(condition: condition, kept: overlaps ? .type(base) : .never, rest: .type(type), isRefused: !overlaps)
    }

    private func classesDeclared(before index: Int) -> [String] {
        nameOfGroup.values.filter { name in
            guard name.hasPrefix("C"), let number = Int(name.dropFirst()), let begin = indexOfDefinition[Variable(number: number)] else { return false }
            return end(ofBlockAt: begin) < index
        }.sorted()
    }

    private func isDerived(_ arm: TypeScriptType, from base: String) -> Bool {
        guard case .named(var name) = arm else { return false }
        while name != base {
            guard let next = baseOf[name] else { return false }
            name = next
        }
        return true
    }

    private func testInstance(_ s: String, _ type: TypeScriptType, at index: Int) -> Test {
        let classes = classesDeclared(before: index)
        let name = !classes.isEmpty && choices.percent(60) ? choices.pick(classes) : choices.pick(Self.usesOfLibraryObjects.keys.sorted() + ["Array"])
        if name == "Pretender" { helpers.insert("Pretender") }
        let condition = "\(s) instanceof \(name)"
        guard isFollowed(type), !type.arms.map(tag(of:)).contains(nil) else {
            return Test(condition: condition, kept: type == .unknown || type == .any ? .type(name == "Array" ? .array(.any) : .named(name)) : .unfollowed, rest: .unfollowed, isUnsure: true)
        }
        let isRefused = type.arms.allSatisfy { $0 == .null || !["object", "function"].contains(tag(of: $0)!) }
        func isKept(_ arm: TypeScriptType) -> Bool {
            if name == "Array" {
                switch arm {
                case .array, .tuple: return true
                default: return false
                }
            }
            if case .generic(name, _) = arm { return true }
            return isDerived(arm, from: name)
        }
        let kept = type.arms.filter(isKept)
        return Test(
            condition: condition, kept: kept.isEmpty ? .type(name == "Array" ? .array(.any) : .named(name)) : narrowed(kept),
            rest: narrowed(type.arms.filter { !isKept($0) }), isRefused: isRefused, isUnsure: true)
    }

    private func testMember(_ s: String, _ type: TypeScriptType) -> Test? {
        var names = [String]()
        for arm in type.arms {
            guard case .named(let name) = arm, members[name] != nil else { return nil }
            names += allMembers(of: name).map(\.name)
        }
        let key = choices.percent(80) && !names.isEmpty ? choices.pick(names) : "missing"
        let holders = type.arms.filter { member(key, of: $0) != nil }
        return Test(
            condition: "\"\(key)\" in \(s)", kept: holders.isEmpty ? .unfollowed : narrowed(holders),
            rest: holders.isEmpty ? .type(type) : narrowed(type.arms.filter { member(key, of: $0).map(\.isOptional) ?? true }), isUnsure: true)
    }

    /// A function that says what its argument is. Some of them say it whatever the argument is.
    private func testGuard(_ s: String, _ type: TypeScriptType) -> Test {
        let guarded = choices.pick(Self.guardedTypes)
        let (prefix, check) = choices.pick([
            ("is", guarded.check), ("is", guarded.check), ("isAlways", "true"), ("isNever", "false"), ("isNot", "!(\(guarded.check))"),
        ])
        let name = "\(prefix)\(guarded.name)"
        writtenHelpers[name] = "function \(name)(value: unknown): value is \(guarded.text) { return \(check); }"
        return split(type, by: guarded.type, condition: "\(name)(\(s))")
    }

    /// What a function that says `value is T` leaves of a type.
    private func split(_ type: TypeScriptType, by candidate: TypeScriptType, condition: String) -> Test {
        guard isFollowed(type) else { return Test(condition: condition, kept: .type(candidate), rest: .unfollowed) }
        guard !type.arms.map(tag(of:)).contains(nil) else { return Test(condition: condition, kept: .unfollowed, rest: .unfollowed) }
        func isKept(_ arm: TypeScriptType) -> Bool {
            if case .array = candidate {
                switch arm {
                case .array, .tuple: return true
                default: return false
                }
            }
            return candidate.arms.contains { tag(of: $0) == tag(of: arm) && ($0 == .null) == (arm == .null) }
        }
        let kept = type.arms.filter(isKept)
        let rest = narrowed(type.arms.filter { !isKept($0) })
        if !kept.isEmpty { return Test(condition: condition, kept: narrowed(kept), rest: rest) }
        let hasObjects = type.arms.contains { $0 != .null && ["object", "function"].contains(tag(of: $0)!) }
        let meets = hasObjects && !candidate.arms.contains(where: \.isNullish)
        if case .array = candidate { return Test(condition: condition, kept: .unfollowed, rest: rest) }
        return Test(condition: condition, kept: meets ? .type(candidate) : .never, rest: rest, isUnsure: meets)
    }

    private func testNamedGuard(_ s: String, _ type: TypeScriptType) -> Test? {
        guard let name = pickNamedType(where: { !self.allMembers(of: $0).isEmpty }) else { return nil }
        let key = choices.pick(allMembers(of: name)).name
        let (prefix, check) = choices.pick([
            ("is", "typeof value === \"object\" && value !== null && \"\(key)\" in value"), ("isAlways", "true"), ("isNever", "false"),
        ])
        let helper = "\(prefix)\(name)"
        helpersThatNameTypes[helper] = "function \(helper)(value: unknown): value is \(name) { return \(check); }"
        let kept = isFollowed(type) ? type.arms.filter { assignable($0, to: .named(name)) } : []
        return Test(
            condition: "\(helper)(\(s))", kept: kept.isEmpty ? .type(.alias(name, .named(name))) : narrowed(kept),
            rest: isFollowed(type) ? narrowed(type.arms.filter { !assignable($0, to: .named(name)) }) : .unfollowed, isUnsure: true)
    }

    private func makeTest(on subject: Subject, as type: TypeScriptType) -> Test {
        let s = subject.text
        var test: Test
        switch choices.weighted([30, 10, 12, 10, 12, 8, 14, 8, 6]) {
        case 0:
            let own = type.arms.compactMap(tag(of:))
            test = testTypeof(s, type, !own.isEmpty && choices.percent(60) ? choices.pick(own) : choices.pick(["string", "number", "boolean", "object", "function", "undefined", "bigint", "symbol"]))
        case 1: test = testNothing(s, type)
        case 2: test = testTruth(s, type)
        case 3: test = testValue(s, type)
        case 4: test = testInstance(s, type, at: subject.index)
        case 5: test = testMember(s, type) ?? testTypeof(s, type, "object")
        case 6: test = testGuard(s, type)
        case 7: test = testNamedGuard(s, type) ?? testGuard(s, type)
        default: test = split(type, by: .array(.any), condition: "Array.isArray(\(s))")
        }
        return choices.percent(25) ? test.negated : test
    }

    // MARK: The statements

    /// run-batch.ts reads the messages of documented differences from stderr, which it doesn't compare.
    private static let messageToStderr = "console.error(String((error as any)?.[\"message\"]));"

    private func note(_ expression: String, ignoring: Bool = false) -> String {
        helpers.insert("note")
        return "\(ignoring ? Self.ignoredLineMarker : "")note(\(expression));"
    }

    private func indented(_ lines: [String]) -> [String] { lines.map { "    \($0)" } }

    /// Statements that test a value and use it as what is left of its type.
    private func writeTest(on subject: Subject, as type: TypeScriptType, depth: Int = 0) -> [String] {
        let s = subject.text
        let test = makeTest(on: subject, as: type)
        let mark = test.isRefused ? Self.ignoredLineMarker : ""
        let unsure = test.isUnsure
        let kept = use(s, as: test.kept)
        let rest = use(s, as: test.rest)
        func further(_ narrowed: Narrowed, _ otherwise: String) -> [String] {
            if depth < 2, case .type(let left) = narrowed, !unsure, left.arms.count > 1 || choices.percent(20) {
                return writeTest(on: subject, as: left, depth: depth + 1)
            }
            return [note(otherwise, ignoring: unsure)]
        }
        var form = choices.below(subject.isConstant ? 13 : 11)
        if form == 5, isInStaticBlock(subject.index) { form = 0 }
        switch form {
        case 0, 1:
            var lines = ["\(mark)if (\(test.condition)) {"]
            lines += indented(further(test.kept, kept))
            lines.append("} else {")
            lines += indented(further(test.rest, rest))
            lines.append("}")
            return lines
        case 2: return [note("\(test.condition) ? \(kept) : \(rest)", ignoring: unsure || test.isRefused)]
        case 3: return ["\(mark)\(unsure ? Self.ignoredLineMarker : "")\(test.condition) && note(\(kept));"]
        case 4: return ["\(mark)\(unsure ? Self.ignoredLineMarker : "")\(test.condition) || note(\(rest));"]
        case 5:
            var lines = ["tested\(depth): {", "    \(mark)if (\(test.condition)) break tested\(depth);"]
            lines += indented(further(test.rest, rest))
            lines.append("}")
            return lines
        case 6:
            return [
                "note((() => {", "    \(mark)\(unsure ? Self.ignoredLineMarker : "")if (\(test.condition)) return \(kept);",
                "    \(unsure ? Self.ignoredLineMarker : "")return \(rest);", "})());",
            ]
        case 7:
            var lines = ["\(mark)while (\(test.condition)) {"]
            lines += indented(further(test.kept, kept))
            lines += ["    break;", "}"]
            return lines
        case 8:
            let turns = choices.pick([2, 3, 20])
            var lines = ["for (let turn = 0; turn < \(turns); turn++) {", "    \(mark)if (\(test.condition)) {"]
            lines += indented(indented(further(test.kept, kept)))
            lines.append("    } else {")
            lines += indented(indented(further(test.rest, rest)))
            lines += ["    }", "}"]
            return lines
        case 9:
            let helper = choices.pick(["assert", "assume"])
            helpers.insert(helper)
            let copy = Subject(text: "copy\(depth)", type: type, isConstant: true, index: subject.index)
            let copied = makeTest(on: copy, as: type)
            return [
                "{", "    const \(copy.text): \(type.text) = \(s);", "    \(copied.isRefused ? Self.ignoredLineMarker : "")\(helper)(\(copied.condition));",
                "    \(note(use(copy.text, as: copied.kept), ignoring: copied.isUnsure))", "}",
            ]
        case 10:
            let holder = choices.below(3)
            let path = Subject(text: ["holder\(depth).held", "pair\(depth)[0]", "keeper\(depth).held"][holder], type: type, isConstant: false, index: subject.index)
            if holder == 2 { helpers.insert("Keeper") }
            let declaration = [
                "const holder\(depth): { held: \(type.text) } = { held: \(s) };", "const pair\(depth): [\(type.text), number] = [\(s), 1];",
                "const keeper\(depth) = new Keeper<\(type.text)>(\(s));",
            ][holder]
            var lines = ["{", "    \(declaration)"]
            lines += indented(writeTest(on: path, as: type, depth: depth + 1))
            lines.append("}")
            return lines
        case 11:
            return ["{", "    \(mark)const passes = \(test.condition);", "    if (passes) \(note(kept, ignoring: unsure))", "    else \(note(rest, ignoring: unsure))", "}"]
        default:
            return ["\(mark)if (\(test.condition)) {", "    \(note("[0, 1].map(() => \(kept))", ignoring: unsure))", "}"]
        }
    }

    /// A `switch` over what `typeof` gives.
    private func writeSwitchOverTypeof(on subject: Subject) -> [String] {
        let s = subject.text
        var lines = ["switch (typeof \(s)) {"]
        var left = subject.type.arms
        let isExact = isFollowed(subject.type) && !left.map(tag(of:)).contains(nil)
        var tags = ["string", "number", "boolean", "object", "function", "undefined", "bigint", "symbol"]
        for _ in 0..<(1 + choices.below(4)) {
            let wanted = tags.remove(at: choices.below(tags.count))
            let kept: Narrowed = isExact ? narrowed(left.filter { tag(of: $0) == wanted }) : (isFollowed(subject.type) ? .unfollowed : primitive(for: wanted).map { .type($0) } ?? .unfollowed)
            left.removeAll { tag(of: $0) == wanted }
            lines += ["    case \"\(wanted)\":", "        \(note(use(s, as: kept)))", "        break;"]
        }
        lines += ["    default:", "        \(note(use(s, as: isExact ? narrowed(left) : .unfollowed)))", "}"]
        return lines
    }

    /// A `switch` over the value itself, with cases of its type and of others.
    private func writeSwitchOverValue(on subject: Subject) -> [String] {
        let s = subject.text
        var lines = ["switch (\(s)) {"]
        var cases = ["0", "1", "-1", "1.5", "\"\"", "\"a\"", "\"text\"", "true", "false", "null", "undefined", "10n"]
        for _ in 0..<(2 + choices.below(4)) {
            let value = cases.remove(at: choices.below(cases.count))
            lines += ["    \(Self.ignoredLineMarker)case \(value):", "        \(note("[\(value), \(s)]"))", choices.percent(80) ? "        break;" : "        // Goes on."]
        }
        let isPlain = subject.type.arms.count == 1 && !subject.type.isLiterals && !subject.type.mentionsEnumeration && subject.type != .boolean
        lines += ["    default:", "        \(note(isPlain ? use(s, as: subject.type) : s))", "}"]
        return lines
    }

    /// A union with a member that tells its parts apart, around the value.
    private func writeTaggedUnion(on subject: Subject) -> [String] {
        let other = falsify(subject.type)
        let tags = choices.pick([["\"first\"", "\"second\"", "\"third\""], ["1", "2", "3"], ["true", "false", "null"], ["\"a\"", "1", "undefined"]])
        let given = choices.percent(70) ? choices.pick(tags) : choices.pick(["\"fourth\"", "4", "{}", "\"\""])
        let first = use("tagged.value", as: subject.type)
        let second = use("tagged.value", as: other)
        var lines = [
            "type Tagged = { kind: \(tags[0]); value: \(subject.type.text) } | { kind: \(tags[1]); value: \(other.text) } | { kind: \(tags[2]); other: number };",
            "const tagged: Tagged = { kind: \(given), value: \(subject.text) } as any;",
        ]
        switch choices.below(4) {
        case 0:
            lines += [
                "switch (tagged.kind) {", "    case \(tags[0]):", "        \(note(first))", "        break;", "    case \(tags[1]):",
                "        \(note(second))", "        break;", "    case \(tags[2]):", "        \(note("tagged.other + 1"))", "        break;",
                "    default:", "        const impossible: never = tagged;", "        \(note("impossible"))", "}",
            ]
        case 1:
            lines += [
                "if (tagged.kind === \(tags[0])) \(note(first))", "else if (tagged.kind !== \(tags[1])) \(note("tagged.other * 2"))",
                "else \(note(second))",
            ]
        case 2:
            lines += [
                "const { kind } = tagged;", "if (\"other\" in tagged) \(note("tagged.other - 1"))",
                "else if (tagged.kind === \(tags[1])) \(note(second))", "else \(note(first))", note("kind"),
            ]
        default:
            lines += [
                "const read = (from: Tagged): unknown => (from.kind === \(tags[0]) ? \(first.replacingOccurrences(of: "tagged.", with: "from.")) : from.kind === \(tags[1]) ? \(second.replacingOccurrences(of: "tagged.", with: "from.")) : from.other);",
                "for (let turn = 0; turn < 3; turn++) \(note("read(tagged)"))",
            ]
        }
        return lines
    }

    /// Reads that stop at `null` and `undefined`.
    private func writeOptionalReads(on subject: Subject) -> [String] {
        let s = subject.text
        let present = subject.type.withoutNullish
        guard isFollowed(subject.type), present.arms.count == 1, !present.isNullish else { return [note("\(s) ?? \"nothing\"")] }
        var lines = [String]()
        switch present.plain {
        case .named(let name) where !allMembers(of: name).isEmpty:
            let (key, member) = choices.pick(allMembers(of: name))
            let isIdentifier = read(key, of: "") == ".\(key)"
            let value = isIdentifier ? "\(s)?.\(key)" : "\(s)?.[\"\(key)\"]"
            lines += [note(value), note("\(value) ?? \"absent\"")]
            if !member.isOptional, !member.isMethod, present == present.plain {
                lines += ["if (\(value) !== undefined) \(note(use(read(key, of: s), as: member.type, depth: 1), ignoring: true))"]
            }
        case .array, .readonlyArray, .tuple, .string:
            lines += [note("\(s)?.length"), note("\(s)?.[0]"), note("(\(s)?.length ?? -1) + 1"), "if (\(s)?.length) \(note(use(s, as: present)))"]
        case .number, .boolean, .bigint:
            lines += [note("\(s)?.toString()"), note(use("(\(s) ?? \(present.plain == .number ? "0" : present.plain == .boolean ? "false" : "0n"))", as: present.plain))]
        default:
            lines += [note("\(s) ?? \"nothing\"")]
        }
        return lines
    }

    private func writeStatements(on subject: Subject) -> [String] {
        helpers.insert("note")
        switch choices.weighted([50, 10, 10, 15, 15]) {
        case 1: return writeSwitchOverTypeof(on: subject)
        case 2: return writeSwitchOverValue(on: subject)
        case 3: return writeTaggedUnion(on: subject)
        case 4: return writeOptionalReads(on: subject)
        default: return writeTest(on: subject, as: subject.type)
        }
    }

    private func enclose(_ lines: [String]) -> [String] {
        let isGuarded = choices.percent(80)
        var enclosed = [isGuarded ? "try {" : "{"]
        enclosed += indented(lines)
        enclosed += isGuarded ? ["} catch (error) {", "    \(note("(error as any)?.name"))", "    \(Self.messageToStderr)", "}"] : ["}"]
        return enclosed
    }

    /// A type to declare for a value that can be anything.
    private func drawType() -> TypeScriptType {
        func one() -> TypeScriptType {
            if choices.percent(35), let name = pickNamedType(where: { !self.allMembers(of: $0).isEmpty }) { return .named(name) }
            return choices.pick([
                .number, .number, .string, .string, .boolean, .bigint, .symbol, .null, .undefined, .array(.number), .array(.string),
                .tuple([.number, .string]), .readonlyArray(.number), .array(.union([.number, .string])),
            ])
        }
        switch choices.below(10) {
        case 0: return choices.pick([.unknown, .any])
        case 1, 2, 3: return one()
        case 4, 5, 6, 7: return .union(of: [one(), one()])
        default: return .union(of: [one(), one(), one()])
        }
    }

    /// Statements that change what a variable holds, or call what the program declares, with values of every kind.
    private func disturb(_ v: Variable, named n: String) -> [String]? {
        func value() -> String { choices.pick(Self.valuesOfEveryKind) }
        var lines = [String]()
        let any = "(\(n) as any)"
        for _ in 0..<(1 + choices.below(2)) {
            var candidates = [String]()
            switch (declared[v] ?? .untracked).plain {
            case .named(let name) where !allMembers(of: name).isEmpty:
                let key = choices.pick(allMembers(of: name)).name
                let member = read(key, of: any)
                candidates = [
                    "\(member) = \(value());", "\(member) = \(value());", "delete \(member);", "\(any).extra = \(value());",
                    "Object.defineProperty(\(n), \"\(key)\", { get() { return \(value()); }, configurable: true });",
                    "Object.defineProperty(\(n), \"\(key)\", { value: \(value()), writable: false });",
                    "Object.setPrototypeOf(\(n), \(choices.pick(["null", "[]", "{ \"\(key)\": 1 }", "new Proxy({}, {})"])));",
                    "Object.freeze(\(n));", "Object.seal(\(n));", "Object.preventExtensions(\(n));",
                    "Object.assign(\(any), { \"\(key)\": \(value()) });",
                ]
                for method in (methods[name] ?? [:]).keys.sorted() {
                    candidates += ["note(\(read(method, of: any))(\(value()), \(value())));", "\(read(method, of: any)) = () => \(value());"]
                }
            case .array, .readonlyArray, .tuple:
                candidates = [
                    "\(any)[0] = \(value());", "\(any)[1] = \(value());", "\(any).push(\(value()));", "\(any).length = 0;", "delete \(any)[0];",
                    "\(any)[10] = \(value());", "\(any).extra = 1;", "Object.freeze(\(n));", "\(any).unshift(\(value()));",
                    "Object.defineProperty(\(n), 0, { get() { return \(value()); }, configurable: true });", "\(any).length = 3;",
                    "Object.setPrototypeOf(\(n), \(choices.pick(["null", "{}", "{ 0: \"inherited\", length: 1 }"])));", "\(any).fill(\(value()));",
                ]
            case .generic("Map", _): candidates = ["\(any).set(\(value()), \(value()));", "\(any).clear();", "\(any).set(\"key\", \(value()));"]
            case .generic("Set", _): candidates = ["\(any).add(\(value()));", "\(any).clear();"]
            case .function:
                candidates = [
                    "note(\(any)(\(value()), \(value())));", "note(\(any).call(\(value()), \(value())));", "note(new \(any)(\(value())));",
                    "note(\(any)());", "note([\(value()), \(value())].map(\(any)));",
                ]
            case .classOf(let name):
                candidates = ["note(new \(any)(\(value()), \(value())));", "note(new \(any)());", "\(any).extra = \(value());"]
                for method in (methods[name] ?? [:]).keys.sorted() {
                    candidates += ["\(read(method, of: "\(any).prototype")) = () => \(value());", "note(\(read(method, of: "new \(any)()"))(\(value())));"]
                }
            case .number, .string, .boolean, .bigint, .union, .literals:
                if reassigned.contains(v) { candidates = ["\(any) = \(value());"] }
            default: break
            }
            if choices.percent(25) {
                helpers.insert("shelf")
                let place = choices.pick(["count", "names", "names[0]", "top", "top.held", "pairs[0]", "pairs[0][0]", "pairs[0][1]", "names.length"])
                candidates += ["(shelf as any).\(place) = \(choices.percent(50) ? n : value()); note(readShelf());"]
            }
            if importsCommonFiles {
                candidates += [
                    "note(commonExports.double(\(n)));", "commonExports.held.count = \(n); note(commonExports.held);", "note(commonExports.count());",
                    "commonExports.held.names.push(\(n)); note(commonExports.held.names.length);",
                ]
            }
            if !functionsAtTheTop.isEmpty {
                let function = choices.pick(functionsAtTheTop)
                candidates += ["note((\(function) as any)(\(value()), \(n), \(value())));", "note((\(function) as any)(\(n)));"]
            }
            if !classesSoFar.isEmpty {
                let name = choices.pick(classesSoFar)
                candidates.append("note(new (\(name) as any)(\(value()), \(n)));")
                for method in (methods[name] ?? [:]).keys.sorted() {
                    candidates.append("note(\(read(method, of: "new (\(name) as any)(\(n))"))(\(value()), \(n)));")
                }
            }
            guard !candidates.isEmpty else { return nil }
            lines.append(choices.pick(candidates))
        }
        helpers.insert("note")
        return ["try {"] + indented(lines) + ["} catch (error) {", "    note((error as any)?.name);", "    \(Self.messageToStderr)", "}"]
    }

    /// What is written behind the declaration of a variable.
    fileprivate func testsBehindDeclaration(of v: Variable, named name: String, isStore: Bool = false) -> [String] {
        guard let index = indexOfDefinition[v], sitesWithTests < 10, inferred[v]?.group != "Date" else { return [] }
        choose(at: index, for: 0x7e57)
        if isScenesAlone {
            if sitesWithTests <= Int(seedOfProgram / 1100 % 4) {
                sitesWithTests += 1
                let (helpersOfTheRest, variablesOfTheRest) = (helpers, moduleVariables)
                (helpers, moduleVariables) = (helpersOfTheScenes, variablesOfTheScenes)
                scenesOfTheProgram += withTwin(choices.percent(settings.withoutCasts) ? sceneWithoutCasts(of: v, named: name) : sceneBehindDeclaration(of: v, named: name, at: index), site: v.number)
                (helpersOfTheScenes, variablesOfTheScenes) = (helpers, moduleVariables)
                (helpers, moduleVariables) = (helpersOfTheRest, variablesOfTheRest)
            }
            return []
        }
        guard choices.percent(settings.tested) else { return [] }
        sitesWithTests += 1
        if choices.percent(settings.withoutCasts) { return withTwin(sceneWithoutCasts(of: v, named: name), site: v.number) }
        if choices.percent(30), let lines = disturb(v, named: name) { return lines }
        if !isStore, let type = annotations[v], type != .int32, !type.arms.contains(.int32), choices.percent(60) {
            var isExact = type.arms.count == 1 && type.plain != .boolean && !type.isLiterals && !type.mentionsEnumeration
            switch outputConversions[v] {
            case .toAny?, .throughUnknown?, .helper?, .parsed?: isExact = true
            default: break
            }
            if isExact || acceptance != .casts {
                return enclose(writeStatements(on: Subject(text: name, type: type, isConstant: !reassigned.contains(v), index: index)))
            }
        }
        if choices.percent(50) { return withTwin(sceneBehindDeclaration(of: v, named: name, at: index), site: v.number) }
        let type = drawType()
        let function = "test\(v.number)"
        var given = [name]
        for _ in 0..<(1 + choices.below(4)) { given.append(choices.pick(Self.valuesOfEveryKind)) }
        let body = enclose(writeStatements(on: Subject(text: "value", type: type, isConstant: true, index: index)))
        let calls =
            choices.percent(50)
            ? ["for (const given of [\(given.joined(separator: ", "))] as any[]) \(function)(given);"]
            : given.map { "\(function)((\($0)) as any);" }
        var lines = ["{", "    function \(function)(value: \(type.text)): void {"]
        lines += indented(indented(body))
        lines.append("    }")
        lines += indented(calls)
        lines.append("}")
        return lines
    }

    /// Writes the tests between the lines of a program.
    fileprivate func addTests(to lines: [Substring]) -> [Substring] {
        let canTest = settings.tested > 0 && !code.contains { $0.op is BeginCodeString }
        var result = [Substring]()
        var storedTo = Set<Int>()
        var openClass: String? = nil
        for line in lines {
            for keyword in ["function f", "async function f", "function* f", "async function* f"] where line.hasPrefix(keyword) {
                functionsAtTheTop.append("f" + line.dropFirst(keyword.count).prefix(while: \.isNumber))
            }
        }
        for line in lines {
            if line.hasPrefix("class C") { openClass = "C" + line.dropFirst(7).prefix(while: \.isNumber) }
            if line == "}", let name = openClass {
                classesSoFar.append(name)
                openClass = nil
            }
            let indentation = String(line.prefix(while: { $0 == " " }))
            var added = [String]()
            var written = line
            if let marker = line.range(of: "/*tests "), let end = line[marker.upperBound...].range(of: "*/") {
                let index = Int(line[marker.upperBound..<end.lowerBound])
                written = Substring(line.replacingCharacters(in: marker.lowerBound..<end.upperBound, with: ""))
                if canTest, let index, line.hasSuffix("{") { added = indented(testsBehindHead(at: index)) }
            } else if canTest, line.hasSuffix(";"), !line.hasSuffix(" = undefined;") {
                let words = line.dropFirst(indentation.count)
                for keyword in ["const v", "let v", "v"] where words.hasPrefix(keyword) {
                    let digits = words.dropFirst(keyword.count).prefix(while: \.isNumber)
                    let rest = words.dropFirst(keyword.count + digits.count)
                    guard let number = Int(digits) else { continue }
                    if keyword == "v" {
                        // A variable that is declared in front of a block and gets its value in it.
                        if rest.hasPrefix(" = "), storedTo.insert(number).inserted {
                            added = testsBehindDeclaration(of: Variable(number: number), named: "v\(number)", isStore: true)
                        }
                    } else if rest.hasPrefix(":") || rest.hasPrefix(" ") {
                        added = testsBehindDeclaration(of: Variable(number: number), named: "v\(number)")
                    }
                }
            }
            result.append(written)
            result += added.map { Substring(indentation + $0) }
        }
        return result
    }

    /// Whether the instruction is in a static block of a class, however deep.
    fileprivate func isInStaticBlock(_ index: Int) -> Bool {
        var depth = 0
        for i in stride(from: index - 1, through: 0, by: -1) {
            if code[i].isBlockEnd { depth += 1 }
            guard code[i].isBlockStart else { continue }
            if depth > 0 {
                depth -= 1
            } else if code[i].op is BeginClassStaticInitializer {
                return true
            }
        }
        return false
    }

    /// Whether the instruction is directly in a class that has a base class.
    fileprivate func isInDerivedClass(_ index: Int) -> Bool {
        var depth = 0
        for i in stride(from: index - 1, through: 0, by: -1) {
            if code[i].isBlockEnd { depth += 1 }
            guard code[i].isBlockStart else { continue }
            if depth == 0 {
                if case .beginClassDefinition(let op) = code[i].op.opcode { return op.hasSuperclass }
                return false
            }
            depth -= 1
        }
        return false
    }

    /// What is written at the start of a function.
    fileprivate func testsBehindHead(at index: Int) -> [String] {
        guard let parameters = testedParameters[index], sitesWithTests < 10 else { return [] }
        choose(at: index, for: 0x7e58)
        guard choices.percent(settings.tested * 2) else { return [] }
        sitesWithTests += 1
        let parameter = choices.pick(parameters)
        return enclose(writeStatements(on: Subject(text: parameter.name, type: parameter.type, isConstant: parameter.isConstant, index: index)))
    }
}

// MARK: Values on their way through a program

extension TypeScriptPlan {
    /// An expression over a value of the type, and the type that the checker gives it.
    private func derive(_ s: String, from type: TypeScriptType) -> (text: String, type: TypeScriptType)? {
        var steps: [(String, TypeScriptType)]
        switch type {
        case .number:
            steps = [
                ("\(s) + 1", .number), ("\(s) * 2", .number), ("\(s) | 0", .number), ("-\(s)", .number), ("\(s).toFixed(1)", .string),
                ("`${\(s)}`", .string), ("\(s) < 3", .boolean), ("[\(s), \(s)]", .array(.number)), ("Math.max(\(s), 1)", .number),
                ("convert(\(s))", .string),
            ]
            helpers.insert("convert")
        case .string:
            steps = [
                ("\(s).length", .number), ("\(s) + \"!\"", .string), ("\(s).slice(1)", .string), ("\(s).split(\"\")", .array(.string)),
                ("\(s).charCodeAt(0)", .number), ("\(s)[0]", .string), ("\(s) < \"m\"", .boolean), ("[\(s)]", .array(.string)),
                ("convert(\(s))", .number), ("longest(\(s), \"ab\")", .string),
            ]
            helpers.insert("convert")
            helpers.insert("longest")
        case .boolean: steps = [("!\(s)", .boolean), ("\(s) ? 1 : 2", .number), ("Number(\(s))", .number), ("String(\(s))", .string)]
        case .bigint: steps = [("\(s) + 1n", .bigint), ("\(s).toString()", .string), ("\(s) > 0n", .boolean)]
        case .array(let element):
            steps = [
                ("\(s).length", .number), ("\(s).slice(0, 2)", type), ("[...\(s)]", type), ("\(s).map(element => element)", type),
                ("\(s).join()", .string), ("\(s).concat(\(s))", type), ("\(s).filter(() => true)", type),
            ]
            if element != .any, element != .unknown { steps += [("\(s)[0]", element), ("\(s)[\(s).length - 1]", element)] }
        case .tuple(let elements):
            steps = [("\(s).length", .number)]
            if let first = elements.first { steps.append(("\(s)[0]", first)) }
        case .named(let name):
            steps = allMembers(of: name).filter { !$0.member.isOptional && !$0.member.isMethod && $0.member.type != .int32 && genericFields[name] != $0.name }
                .map { (read($0.name, of: s), $0.member.type) }
        case .function(let parameters, let result) where !parameters.contains(where: \.isRest):
            steps = [("\(s)(\(parameters.map { sample(of: $0.type) ?? "undefined as any" }.joined(separator: ", ")))", result)]
        default: return nil
        }
        steps.removeAll { $0.1 == .untracked || $0.1 == .void }
        return steps.isEmpty ? nil : choices.pick(steps)
    }

    /// A value that has the type.
    private func sample(of type: TypeScriptType) -> String? {
        switch type {
        case .number: return choices.pick(["1", "0", "2.5", "-3", "1073741824"])
        case .string: return choices.pick(["\"a\"", "\"\"", "\"sample\""])
        case .boolean: return choices.pick(["true", "false"])
        case .bigint: return "1n"
        case .null: return "null"
        case .undefined: return "undefined"
        case .any, .unknown: return "0"
        case .array(let element), .readonlyArray(let element): return sample(of: element).map { "[\($0), \($0)]" }
        case .tuple(let elements):
            let samples = elements.map(sample(of:))
            return samples.contains(nil) ? nil : "[\(samples.map { $0! }.joined(separator: ", "))]"
        case .union(let arms): return arms.first.flatMap(sample(of:))
        case .int32: return "1"
        case .object: return "{}"
        case .alias(_, let aliased): return sample(of: aliased)
        case .function(_, let result): return result == .void ? "(() => {})" : sample(of: result).map { "(() => (\($0)))" }
        case .named(let name):
            guard depthOfSample < 2, interfaceOrder.contains(name) else { return nil }
            depthOfSample += 1
            defer { depthOfSample -= 1 }
            var parts = [String]()
            for (key, member) in allMembers(of: name) where !member.isOptional || choices.percent(50) {
                if member.isMethod, case .function(_, let result) = member.type, let value = result == .void ? "undefined" : sample(of: result) {
                    parts.append("\(propertyKey(key))() { return \(value); }")
                } else if let value = sample(of: member.type) {
                    parts.append("\(propertyKey(key)): \(value)")
                } else if !member.isOptional {
                    return nil
                }
            }
            var owner: String? = name
            while let current = owner {
                parts += (methods[current] ?? [:]).keys.sorted().map { "\(propertyKey($0))(...values: any[]) { return values.length; }" }
                owner = baseOf[current]
            }
            return "{ \(parts.joined(separator: ", ")) }"
        default: return nil
        }
    }

    /// Lines that hand a value on, and where it is afterwards.
    private func carry(_ s: String, _ type: TypeScriptType, _ step: Int, site: Int) -> (lines: [String], text: String) {
        if choices.percent(45) { return carryThroughDeclaredCode(s, type, step) }
        var t = type.text
        if case .function = type { t = "(\(t))" }
        let list = TypeScriptType.array(type).text
        switch choices.below(12) {
        case 0: return (["const carried\(step) = \(s);"], "carried\(step)")
        case 1: return (["const carried\(step): \(t) = \(s);"], "carried\(step)")
        case 2: return (["const shelf\(step): { held: \(t) } = { held: \(s) };"], "shelf\(step).held")
        case 3:
            return (["let captured\(step): \(t) = \(s);", "const read\(step) = (): \(t) => captured\(step);", "const write\(step) = (next: \(t)): void => { captured\(step) = next; };", "write\(step)(read\(step)());"], "read\(step)()")
        case 4:
            moduleVariables.append("let kept\(site)_\(step): any;")
            return (["kept\(site)_\(step) = \(s);", "const readKept\(step) = (): \(t) => kept\(site)_\(step);"], "readKept\(step)()")
        case 5: return (["const handOn\(step) = (given: \(t)): \(t) => given;"], "handOn\(step)(\(s))")
        case 6: return (["const list\(step): \(list) = [\(s), \(s)];"], choices.pick(["list\(step)[1]", "list\(step)[list\(step).length - 1]", "[...list\(step)][0]", "list\(step).map(element => element)[0]"]))
        case 7: return (["const map\(step) = new Map<string, \(t)>([[\"key\", \(s)]]);"], "map\(step).get(\"key\")!")
        case 8: return (["const [first\(step), ...others\(step)]: \(list) = [\(s), \(s)];"], choices.pick(["first\(step)", "others\(step)[0]"]))
        case 9: return (["const { held: taken\(step) }: { held: \(t) } = { held: \(s) };"], "taken\(step)")
        case 10:
            helpers.insert("Keeper")
            return (["const keeper\(step) = new Keeper<\(t)>(\(s));"], "keeper\(step).held")
        default: return (["let found\(step): \(t) = \(s);", "for (const element of new Set<\(t)>([\(s)])) found\(step) = element;"], "found\(step)")
        }
    }

    /// Through generic classes and functions, an abstract class, decorated members, a `this` parameter and classes of the function itself.
    private func carryThroughDeclaredCode(_ s: String, _ type: TypeScriptType, _ step: Int) -> (lines: [String], text: String) {
        var t = type.text
        if case .function = type { t = "(\(t))" }
        func with(_ helper: String) { helpers.insert(helper) }
        switch choices.below(sceneIsAsync ? 14 : 13) {
        case 0:
            with("Pile")
            return (["const pile\(step) = new Pile<\(t)>().add(\(s)).add(\(s));"], choices.pick(["pile\(step).top()", "pile\(step).map<\(t)>(item => item).top()", "pile\(step).all()[0]"]))
        case 1:
            with("Source")
            return (["const source\(step): Source<\(t)> = new Fixed<\(t)>(\(s));"], choices.pick(["source\(step).take()", "source\(step).next()"]))
        case 2:
            with("Lazy")
            return (["const lazy\(step) = new Lazy<\(t)>(() => \(s));"], "lazy\(step).value")
        case 3:
            with("Watched")
            return (["const watched\(step) = new Watched<\(t)>(\(s));"], choices.pick(["watched\(step).read()", "watched\(step).held", "watched\(step).seen"]))
        case 4:
            return (["function readHeld\(step)(this: { held: \(t) }): \(t) { return this.held; }"], choices.pick(["readHeld\(step).call({ held: \(s) })", "readHeld\(step).apply({ held: \(s) })", "readHeld\(step).bind({ held: \(s) })()"]))
        case 5:
            with("Link")
            return (["const link\(step): Link<\(t)> = { value: \(s), next: { value: \(s), next: null } };"], choices.pick(["link\(step).next!.value", "link\(step).value"]))
        case 6:
            with("Outcome")
            return ([
                "const wrap\(step) = (given: \(t)): Outcome<\(t)> => ({ ok: true, value: given });", "const outcome\(step) = wrap\(step)(\(s));",
                "if (!outcome\(step).ok) throw new RangeError(outcome\(step).reason);",
            ], "outcome\(step).value")
        case 7:
            return ([
                "function inner\(step)(given: \(t)): \(t) { return given; }", "function outer\(step)(given: \(t)): \(t) { return inner\(step)(given); }",
            ], "outer\(step)(\(s))")
        case 8:
            return ([
                "class Carrier\(step) {", "    private held: \(t);", "    static last: \(t);", "    constructor(held: \(t)) { this.held = Carrier\(step).last = held; }",
                "    read(): \(t) { return this.held; }", "}", "const carrier\(step) = new Carrier\(step)(\(s));",
            ], choices.pick(["carrier\(step).read()", "Carrier\(step).last"]))
        case 9:
            with("pluck")
            return (["const bag\(step) = { first: \(s), second: 1 };"], "pluck(bag\(step), \"first\")")
        case 10:
            with("choose")
            return ([], "choose<\(t)>(\(s), \(s))")
        case 11:
            return (["function* give\(step)(given: \(t)): Generator<\(t), \(t), unknown> { yield given; return given; }"], choices.pick(["[...give\(step)(\(s))][0]", "give\(step)(\(s)).next().value"]))
        case 12:
            return (["const record\(step): Record<string, \(t)> = { key: \(s) };"], choices.pick(["record\(step).key", "record\(step)[\"key\"]", "Object.values(record\(step))[0]", "Object.entries(record\(step))[0][1]"]))
        default:
            let awaited = choices.pick(["await Promise.resolve(\(s))", "await (async (): Promise<\(t)> => \(s))()", "(await Promise.all([\(s)]))[0]"])
            return (["const awaited\(step) = \(awaited);"], "awaited\(step)")
        }
    }

    /// The value gets another declared type on its way.
    private func declareAnew(_ s: String, _ type: TypeScriptType, _ step: Int) -> (lines: [String], text: String, type: TypeScriptType) {
        let other = falsify(type)
        var t = other.text
        if case .function = other { t = "(\(t))" }
        switch choices.below(5) {
        case 0: return ([], "(\(s) as unknown as \(t))", other)
        case 1:
            helpers.insert("pass")
            return ([], "pass<\(t)>(\(s) as any)", other)
        case 2:
            helpers.insert("Keeper")
            return (["const other\(step) = new Keeper<\(t)>(\(s) as any);"], "other\(step).held", other)
        case 3:
            helpers.insert("Pile")
            return (["const other\(step) = new Pile<\(t)>().add(\(s) as any);"], "other\(step).top()", other)
        default: return (["const other\(step) = new Map<string, \(t)>([[\"key\", \(s) as any]]);"], "other\(step).get(\"key\")!", other)
        }
    }

    /// A value goes through declarations, operations and calls, and is used as what the checker takes it for at the end.
    private func writeJourney(of s: String, _ type: TypeScriptType, site: Int, firstStep: Int = 0) -> [String] {
        var lines = [String]()
        var (text, current) = (s, type)
        for step in firstStep..<(firstStep + 1 + choices.below(4)) {
            if case .named(let name) = current, choices.percent(30),
                let method = (methods[name] ?? [:]).filter({ $0.value.isTracked && $0.value.genericPosition == nil })
                    .sorted(by: { $0.key < $1.key }).first
            {
                let arguments = method.value.parameters.filter { !$0.isOptional && !$0.isRest }.map { sample(of: $0.type) ?? "undefined as any" }
                lines.append("const method\(step) = \(read(method.key, of: text));")
                lines.append(compareOnly(text, current))
                lines.append("const called\(step) = method\(step).call(\(([text] + arguments).joined(separator: ", ")));")
                (text, current) = ("called\(step)", method.value.result == .void ? .undefined : method.value.result == .int32 ? .number : method.value.result)
            } else if !isWithoutCasts, choices.percent(12) {
                let anew = declareAnew(text, current, step)
                lines += anew.lines
                lines.append("const anew\(step) = \(anew.text);")
                (text, current) = ("anew\(step)", anew.type)
            } else if choices.percent(50), let derived = derive(text, from: current) {
                lines.append("const derived\(step) = \(derived.text);")
                (text, current) = ("derived\(step)", derived.type)
            } else {
                let carried = carry(text, current, step, site: site)
                lines += carried.lines
                text = carried.text
            }
            if choices.percent(25) { lines.append(compareOnly(text, current)) }
        }
        if case .function = current, let called = derive(text, from: current) {
            lines.append("const result\(firstStep) = \(called.text);")
            (text, current) = ("result\(firstStep)", called.type)
        }
        lines.append(noteUse(of: text, current))
        return lines
    }

    private func noteUse(of s: String, _ type: TypeScriptType) -> String {
        helpers.insert("note")
        return "note(\(use(s, as: type)));"
    }

    /// A statement that only looks at a value.
    private func compareOnly(_ s: String, _ type: TypeScriptType) -> String {
        helpers.insert("note")
        let same = sample(of: type) ?? "null"
        return choices.pick([
            "\(Self.ignoredLineMarker)if (\(s) === \(same)) note(\"same\");", "\(Self.ignoredLineMarker)switch (\(s)) { case \(same): note(\"case\"); }",
            "note(typeof \(s));", "\(Self.ignoredLineMarker)note(\(s) == \(same));", "note([\(s)].length);", "note(Object.is(\(s), \(s)));",
        ])
    }

    /// The value arrives in a variable that held what its type says until then.
    private func writeLateArrival(of s: String, _ type: TypeScriptType) -> [String]? {
        guard let first = sample(of: type) else { return nil }
        let turns = choices.pick([2, 3, 4, 30])
        let arrival = choices.below(turns)
        var lines = ["let held: \(type.text) = \(first);", "for (let turn = 0; turn < \(turns); turn++) {"]
        if choices.percent(50) {
            lines += ["    \(noteUse(of: "held", type))", "    if (turn === \(arrival)) held = \(s);"]
        } else {
            lines += ["    if (turn === \(arrival)) held = \(s);", "    \(noteUse(of: "held", type))"]
        }
        lines += ["}", noteUse(of: "held", type)]
        return lines
    }

    private func drawPlainType() -> TypeScriptType {
        if choices.percent(30), let name = pickNamedType(where: { !self.allMembers(of: $0).isEmpty }) { return .named(name) }
        return choices.pick([
            .number, .number, .string, .string, .boolean, .bigint, .array(.number), .array(.string), .tuple([.number, .string]),
            .array(.array(.number)), .union([.number, .string]), .union([.string, .null]), .union([.number, .undefined]),
        ])
    }

    private func drawFunctionType() -> TypeScriptType {
        let parameter = choices.pick([TypeScriptType.number, .string, .boolean, .array(.number)])
        let result = choices.pick([TypeScriptType.number, .string, .boolean, .array(.number), .array(.string)])
        return .function(choices.percent(80) ? [TypeScriptParameter(name: "given", type: parameter)] : [], result)
    }

    private static let functionsOfEveryKind = [
        "(given: any) => given", "() => \"text\"", "() => 1.5", "() => undefined", "() => [\"a\"]", "function (this: any) { return this; }",
        "Math.abs", "String", "Array", "async () => 1", "function* () { yield 1; }", "(given: any) => ({ given })", "parseInt",
        "[].push", "Object.keys", "(...all: any[]) => all", "(() => 1).bind(null)", "Symbol",
    ]

    /// Lines that the checker accepts as they stand, behind which a value of the type `from` is where `type` is declared.
    private func arrive(_ s: String, _ from: TypeScriptType, at type: TypeScriptType, _ step: Int) -> (lines: [String], text: String) {
        let (t, either) = (type.text, "(\(type.text)) | (\(from.text))")
        let (narrow, wide) = ("narrow\(step)", "wide\(step)")
        let right = sample(of: type)
        switch (choices.below(12), right) {
        case (0, let right?):
            return (["const \(narrow): (\(t))[] = [\(right)];", "const \(wide): (\(either))[] = \(narrow);", "\(wide)[1] = \(s);"], "\(narrow)[1]")
        case (1, let right?):
            return (["const \(narrow): (\(t))[] = [\(right), \(right)];", "const \(wide): (\(either))[] = \(narrow);", "\(wide)[0] = \(s);"], "\(narrow)[0]")
        case (2, let right?):
            return (["const \(narrow): { held: \(t) } = { held: \(right) };", "const \(wide): { held: \(either) } = \(narrow);", "\(wide).held = \(s);"], "\(narrow).held")
        case (3, let right?):
            helpers.insert("Keeper")
            return (["const \(narrow) = new Keeper<\(t)>(\(right));", "const \(wide): Keeper<\(either)> = \(narrow);", "\(wide).held = \(s);"], "\(narrow).held")
        case (4, _):
            helpers.insert("Pile")
            return (["const \(narrow) = new Pile<\(t)>();", "const \(wide): Pile<\(either)> = \(narrow);", "\(wide).add(\(s));"], "\(narrow).top()")
        case (5, _):
            return (["const \(narrow) = new Map<string, \(t)>();", "const \(wide): Map<string, \(either)> = \(narrow);", "\(wide).set(\"key\", \(s));"], "\(narrow).get(\"key\")!")
        case (6, _):
            return (
                [
                    "class Narrow\(step) {", "    held: (\(t))[] = [];", "    take(value: \(t)): void { this.held.push(value); }", "}",
                    "interface Wide\(step) { take(value: \(either)): void; }", "const \(narrow) = new Narrow\(step)();",
                    "const \(wide): Wide\(step) = \(narrow);", "\(wide).take(\(s));",
                ], "\(narrow).held[0]"
            )
        case (7, let right?):
            return (
                [
                    "class Narrow\(step) {", "    held: \(t) = \(right);", "    take(value: \(t)): void { this.held = value; }", "}",
                    "interface Wide\(step) { take(value: \(either)): void; }", "const \(narrow) = new Narrow\(step)();",
                    "const \(wide): Wide\(step) = \(narrow);", "\(wide).take(\(s));",
                ], "\(narrow).held"
            )
        case (8, let right?):
            return (["const \(narrow): { held: \(t) } = { held: \(right) };", "Object.assign(\(narrow), { held: \(s) });"], "\(narrow).held")
        case (9, _):
            return (
                [
                    "const \(narrow): ((\(t)) | undefined)[] = [];", "function take\(step)(first: \(from.text), second?: \(t)): void { \(narrow).push(second); }",
                    "const one\(step): (first: \(from.text)) => void = take\(step);",
                    "const two\(step): (first: \(from.text), second: \(from.text)) => void = one\(step);", "two\(step)(\(s), \(s));",
                ], "\(narrow)[0]!"
            )
        case (10, let right?):
            return (
                [
                    "const \(wide): { held: \(either) } = { held: \(right) };", "function is\(step)(value: unknown): value is \(t) { return true; }",
                    "function change\(step)(): void { \(wide).held = \(s); }", "const \(narrow): (\(t))[] = [];",
                    "if (is\(step)(\(wide).held)) {", "    change\(step)();", "    \(narrow).push(\(wide).held);", "}",
                ], "\(narrow)[0]"
            )
        default: return (["const \(narrow): (\(t))[] = [];", "const \(wide): (\(either))[] = \(narrow);", "\(wide).push(\(s));"], "\(narrow)[0]")
        }
    }

    /// Lines that the checker accepts as they stand, behind which nothing is where `type` is declared.
    private func leaveOut(_ type: TypeScriptType, _ step: Int) -> (lines: [String], text: String) {
        let t = type.text
        let list = "list\(step)"
        switch (choices.below(14), sample(of: type)) {
        case (0, let right?): return (["const \(list): (\(t))[] = [\(right)];"], "\(list)[1]")
        case (1, _): return (["const table\(step): Record<string, \(t)> = {};"], choices.pick(["table\(step).absent", "table\(step)[\"absent\"]"]))
        case (2, _): return (["const table\(step): { [key: string]: \(t) } = {};", "const key\(step) = \"abs\" + \"ent\";"], "table\(step)[key\(step)]")
        case (3, _): return (["const [, missing\(step)]: (\(t))[] = [];"], "missing\(step)")
        case (4, _): return (["const \(list) = new Array<\(t)>(2);"], "\(list)[1]")
        case (5, _):
            helpers.insert("firstOf")
            return ([], "firstOf<\(t)>([])")
        case (6, _): return (["let later\(step)!: \(t);"], "later\(step)")
        case (7, let right?):
            return (
                [
                    "class Early\(step) {", "    seen: (\(t))[] = [];", "    held: \(t);", "    constructor() {", "        this.look();",
                    "        this.held = \(right);", "    }", "    look(): void { this.seen.push(this.held); }", "}",
                ], "new Early\(step)().seen[0]"
            )
        case (8, let right?):
            return (
                [
                    "const seen\(step): (\(t))[] = [];", "class Base\(step) {", "    constructor() { this.look(); }", "    look(): void {}", "}",
                    "class Derived\(step) extends Base\(step) {", "    held: \(t) = \(right);", "    look(): void { seen\(step).push(this.held); }", "}",
                    "new Derived\(step)();",
                ], "seen\(step)[0]"
            )
        case (9, let right?):
            return (["const part\(step): { held?: \(t) } = { held: undefined };", "const whole\(step): { held: \(t) } = { held: \(right), ...part\(step) };"], "whole\(step).held")
        case (10, let right?): return (["const \(list): (\(t))[] = [\(right), \(right)];", "\(list).length = 0;"], "\(list)[1]")
        case (11, let right?): return (["const \(list): (\(t))[] = [\(right)];", "\(list).length = 3;"], "\(list)[2]")
        case (12, let right?): return (["const \(list): (\(t))[] = [\(right), \(right)];", "delete \(list)[0];"], "\(list)[0]")
        default: return (["const \(list): (\(t))[] = [];"], "\(list)[0]")
        }
    }

    /// As `arrive`, but the value gets there inside a generic function or class that is used at a wider type.
    private func arriveThroughGenerics(_ s: String, _ from: TypeScriptType, at type: TypeScriptType, _ step: Int) -> (lines: [String], text: String) {
        let (t, either) = (type.text, "(\(type.text)) | (\(from.text))")
        let (narrow, wide) = ("narrow\(step)", "wide\(step)")
        switch (choices.below(15), sample(of: type)) {
        case (0, let right?):
            return (
                ["function fill\(step)<T>(box: { held: T }, value: T): void { box.held = value; }", "const \(narrow): { held: \(t) } = { held: \(right) };", "fill\(step)<\(either)>(\(narrow), \(s));"],
                "\(narrow).held"
            )
        case (1, let right?):
            return (
                [
                    "function store\(step)<T, K extends keyof T>(target: T, key: K, value: T[K]): void { target[key] = value; }",
                    "function which\(step)(): \"held\" | \"other\" { return \"held\"; }", "const \(narrow): { held: \(t); other: \(from.text) } = { held: \(right), other: \(s) };",
                    "store\(step)(\(narrow), which\(step)(), \(s));",
                ], "\(narrow).held"
            )
        case (2, let right?):
            return (
                [
                    "class Cell\(step)<T> {", "    held: T;", "    constructor(held: T) { this.held = held; }", "    put(value: T): void { this.held = value; }", "}",
                    "const \(narrow) = new Cell\(step)<\(t)>(\(right));", "const \(wide): Cell\(step)<\(either)> = \(narrow);", "\(wide).put(\(s));",
                ], "\(narrow).held"
            )
        case (3, _):
            return (
                [
                    "class Base\(step)<T> {", "    held!: T;", "    put(value: T): void { this.held = value; }", "}", "class Fixed\(step) extends Base\(step)<\(t)> {}",
                    "const \(narrow) = new Fixed\(step)();", "const \(wide): Base\(step)<\(either)> = \(narrow);", "\(wide).put(\(s));",
                ], "\(narrow).held"
            )
        case (4, _):
            return (["function sure\(step)<T>(value: unknown): asserts value is T {}", "const loose\(step): unknown = \(s);", "sure\(step)<\(t)>(loose\(step));"], "loose\(step)")
        case (5, _):
            return (
                [
                    "function is\(step)<T>(value: unknown): value is T { return true; }", "const loose\(step): unknown = \(s);", "const \(narrow): (\(t))[] = [];",
                    "if (is\(step)<\(t)>(loose\(step))) \(narrow).push(loose\(step));",
                ], "\(narrow)[0]"
            )
        case (6, _):
            return (
                [
                    "interface Sink\(step)<T> { take(value: T): void; }", "class Narrow\(step) implements Sink\(step)<\(t)> {", "    held: (\(t))[] = [];",
                    "    take(value: \(t)): void { this.held.push(value); }", "}", "function feed\(step)<T>(sink: Sink\(step)<T>, value: T): void { sink.take(value); }",
                    "const \(narrow) = new Narrow\(step)();", "feed\(step)<\(either)>(\(narrow), \(s));",
                ], "\(narrow).held[0]"
            )
        case (7, _):
            return (
                [
                    "function remember\(step)<K, V>(map: Map<K, V>, key: K, value: V): void { map.set(key, value); }", "const \(narrow) = new Map<string, \(t)>();",
                    "remember\(step)<string, \(either)>(\(narrow), \"key\", \(s));",
                ], "\(narrow).get(\"key\")!"
            )
        case (8, let right?): return (["const \(narrow): (\(t))[] = [\(right)];", "Array.prototype.push.call(\(narrow), \(s));"], "\(narrow)[1]")
        case (9, let right?):
            return (
                [
                    "function swap\(step)<T extends { held: unknown }>(box: T, value: T[\"held\"]): void { box.held = value; }", "const \(narrow): { held: \(t) } = { held: \(right) };",
                    "swap\(step)<{ held: \(either) }>(\(narrow), \(s));",
                ], "\(narrow).held"
            )
        case (10, let right?):
            return (
                [
                    "function each\(step)<T>(list: T[], visit: (list: T[], value: T) => void, value: T): void { visit(list, value); }", "const \(narrow): (\(t))[] = [\(right)];",
                    "each\(step)<\(either)>(\(narrow), (list, value) => { list[0] = value; }, \(s));",
                ], "\(narrow)[0]"
            )
        case (11, let right?):
            return (
                ["function both\(step)<A, B>(first: A[], second: B[]): (A | B)[] { return first; }", "const \(narrow): (\(t))[] = [\(right)];", "both\(step)<\(t), \(from.text)>(\(narrow), [])[0] = \(s);"],
                "\(narrow)[0]"
            )
        case (12, _):
            return (
                [
                    "class Chain\(step)<T> {", "    items: T[] = [];", "    with<U>(value: U): Chain\(step)<T | U> {", "        const next: Chain\(step)<T | U> = this;",
                    "        next.items.push(value);", "        return next;", "    }", "}", "const \(narrow) = new Chain\(step)<\(t)>();", "\(narrow).with<\(from.text)>(\(s));",
                ], "\(narrow).items[0]"
            )
        case (13, _):
            helpers.insert("Pile")
            return (["function pileUp\(step)<T>(pile: Pile<T>, value: T): Pile<T> { return pile.add(value); }", "const \(narrow) = new Pile<\(t)>();", "pileUp\(step)<\(either)>(\(narrow), \(s));"], "\(narrow).top()")
        default:
            return (["function put\(step)<T>(list: T[], value: T): void { list.push(value); }", "const \(narrow): (\(t))[] = [];", "put\(step)<\(either)>(\(narrow), \(s));"], "\(narrow)[0]")
        }
    }

    /// As `leaveOut`, but it is generic code, used at the type, that finds nothing.
    private func leaveOutThroughGenerics(_ type: TypeScriptType, _ step: Int) -> (lines: [String], text: String) {
        let t = type.text
        switch (choices.below(13), sample(of: type)) {
        case (0, _): return (["function lastOf\(step)<T>(list: T[]): T { return list[list.length - 1]; }"], "lastOf\(step)<\(t)>([])")
        case (1, let right?): return (["function at\(step)<T>(list: readonly T[], index: number): T { return list[index]; }"], "at\(step)<\(t)>([\(right)], 1)")
        case (2, _): return (["function under\(step)<T>(table: Record<string, T>, key: string): T { return table[key]; }"], "under\(step)<\(t)>({}, \"absent\")")
        case (3, _): return ([], "Array.from<\(t)>({ length: 2 })[1]")
        case (4, _): return (["class Slot\(step)<T> {", "    held!: T;", "}"], "new Slot\(step)<\(t)>().held")
        case (5, _): return (["function none\(step)<T>(): T[] { return []; }", "const [missing\(step)] = none\(step)<\(t)>();"], "missing\(step)")
        case (6, _): return (["function given\(step)<T>(value?: T): T { return value!; }"], "given\(step)<\(t)>()")
        case (7, _): return ([], "Object.values<\(t)>({})[0]")
        case (8, _): return (["function orFirst\(step)<T>(list: T[], fallback: T = list[0]): T { return fallback; }"], "orFirst\(step)<\(t)>([])")
        case (9, _): return (["function popped\(step)<T>(list: T[]): T { return list.pop()!; }"], "popped\(step)<\(t)>([])")
        case (10, let right?): return (["function found\(step)<T>(list: T[], test: (value: T) => boolean): T { return list.find(test)!; }"], "found\(step)<\(t)>([\(right)], () => false)")
        case (11, _): return (["class Late\(step)<T> {", "    private made?: T;", "    get value(): T { return this.made!; }", "}"], "new Late\(step)<\(t)>().value")
        default: return (["function second\(step)<A, B>(pair: [A, B?]): B { return pair[1]!; }"], "second\(step)<string, \(t)>([\"a\"])")
        }
    }

    /// Lines that the checker accepts as they stand, in which what a name holds changes although its type says that it doesn't.
    private func changeBehindAFixedName(_ type: TypeScriptType, _ step: Int) -> (lines: [String], text: String)? {
        guard let first = sample(of: type), let second = sample(of: type) else { return nil }
        let t = type.text
        let (open, fixed) = ("open\(step)", "fixed\(step)")
        let isPrimitive = [.number, .string, .boolean, .bigint].contains(type)
        switch choices.below(isPrimitive ? 4 : 3) {
        case 0:
            return (
                ["const \(open): { held: \(t) } = { held: \(first) };", "const \(fixed): Readonly<{ held: \(t) }> = \(open);", noteUse(of: "\(fixed).held", type), "\(open).held = \(second);"],
                "\(fixed).held"
            )
        case 1:
            return (
                ["const \(open): (\(t))[] = [\(first)];", "const \(fixed): readonly (\(t))[] = \(open);", noteUse(of: "\(fixed)[0]", type), "\(open)[0] = \(second);"],
                "\(fixed)[0]"
            )
        case 2:
            return (
                [
                    "class Fixed\(step) {", "    constructor(readonly held: \(t)) {}", "}", "const \(fixed) = new Fixed\(step)(\(first));",
                    "const \(open): { held: \(t) } = \(fixed);", noteUse(of: "\(fixed).held", type), "\(open).held = \(second);",
                ], "\(fixed).held"
            )
        default:
            return (
                ["const \(fixed) = { held: \(first) } as const;", "const \(open): { held: \(t) } = \(fixed);", "note(\(fixed).held);", "\(open).held = \(second);"],
                "\(fixed).held"
            )
        }
    }

    /// Variables of the function that have nothing to do with the value `s`, changed between the statements and printed at the end.
    private func addBystanders(to statements: [String], beside s: String) -> (declarations: [String], statements: [String], end: String, parts: [String]) {
        var lines = statements
        let all = ["tally", "share", "letters", "trail", "ledger", "raise"]
        var present = Set(["tally"])
        switch choices.below(5) {
        case 0, 1: break
        case 2: present.insert(choices.pick(all))
        default: present = Set(all)
        }
        let changes: [(text: String, names: [String])] = [
            ("tally++;", []), ("raise();", ["raise"]), ("trail.push(tally);", ["trail"]), ("ledger.turns += 1;", ["ledger"]), ("(() => { tally += 2; return \(s); })();", []),
            ("letters += \"+\";", ["letters"]), ("for (let i = 0; i < 3; i++) tally += i;", []), ("try { tally++; } finally { trail.push(-1); }", ["trail"]),
            ("[1, 2].forEach(step => { tally += step; });", []), ("ledger = { turns: ledger.turns + 1 };", ["ledger"]),
            ("{ const seen = () => [tally, \(s)]; tally++; trail.push(seen().length); }", ["trail"]), ("if (tally > 0) letters += tally; else tally = 5;", ["letters"]),
            ("share += 0.5;", ["share"]), ("share = share * 2 + tally;", ["share"]), ("trail[trail.length] = share;", ["trail", "share"]),
            ("(() => { tally = 2; \(s); })();", []), ("{ const later = () => { tally += 3; \(s); }; const before = tally; later(); tally += before; }", []),
            ("[() => { tally += 4; \(s); }][0]();", []), ("(() => { (() => { tally += 5; \(s); })(); })();", []),
            ("{ const under = (really: boolean) => { if (really) tally = 6; return \(s); }; under(true); }", []),
            ("for (let i = 0; i < 2; i++) (() => { tally += i + 1; \(s); })();", []), ("try { (() => { tally += 7; \(s); throw new RangeError(\"out\"); })(); } catch { tally += 10; }", []),
        ]
        let possible = changes.filter { $0.names.allSatisfy(present.contains) }.map(\.text)
        for _ in 0..<(1 + choices.below(present.count == 1 ? 2 : 6)) {
            let gaps = lines.indices.filter { !lines[$0].hasPrefix(" ") && !lines[$0].hasPrefix("}") && !lines[$0].hasPrefix("else") } + [lines.count]
            lines.insert(choices.pick(possible), at: choices.pick(gaps))
        }
        let declarations = [
            "tally": "let tally = 0;", "share": "let share = 0.25;", "letters": "let letters = \"\";", "trail": "const trail: number[] = [];", "ledger": "let ledger = { turns: 0 };",
            "raise": "const raise = (): void => { tally++; };",
        ]
        let printed = ["tally": "tally", "share": "share", "letters": "letters", "trail": "trail.join()", "ledger": "ledger.turns"]
        let parts = all.filter(present.contains).compactMap { printed[$0] }
        return (all.filter(present.contains).map { declarations[$0]! }, lines, parts.count == 1 ? parts[0] : "[\(parts.joined(separator: ", "))].join(\" \")", parts)
    }

    /// Beside a scene: a function that makes an object with a key that the journeys use, which holds another type there.
    private func withTwin(_ scene: [String], site: Int) -> [String] {
        guard choices.percent(35), scene.count > 2 else { return scene }
        let type = drawPlainType()
        guard let value = sample(of: type) else { return scene }
        let (key, t, function) = (choices.pick(["held", "held", "held", "value", "first"]), type.text, "twin\(site)")
        var twin = [
            choices.pick([
                "function \(function)(): void { const shelf: { \(key): \(t) } = { \(key): \(value) }; note(typeof shelf.\(key)); }",
                "function \(function)(given: \(t) = \(value)): { \(key): \(t) } { return { \(key): given }; }",
                "function \(function)(): void { const shelf = { \(key): \(value) }; note(Object.keys(shelf).length); }",
            ])
        ]
        if choices.percent(75) { twin.append("\(function)();") }
        helpers.insert("note")
        return choices.percent(50) ? [scene[0]] + indented(twin) + scene.dropFirst() : scene.dropLast() + indented(twin) + [scene[scene.count - 1]]
    }

    /// Another value of the type, computed from the value.
    private func change(_ s: String, _ type: TypeScriptType) -> String? {
        switch type {
        case .number: return choices.pick(["\(s) + 1", "\(s) * 2", "-\(s)"])
        case .string: return choices.pick(["\(s) + 0", "\(s) + \"x\"", "\(s) + \(s)"])
        case .boolean: return "!\(s)"
        case .bigint: return "\(s) + 1n"
        case .array: return choices.pick(["[...\(s)]", "\(s).slice()", "\(s).concat(\(s))"])
        default: return nil
        }
    }

    /// A function of its own that the checker accepts as it stands, in which a value is where another type is declared, and travels on from there.
    fileprivate func sceneWithoutCasts(of v: Variable, named name: String) -> [String] {
        let site = v.number
        let declared = drawPlainType()
        sceneIsAsync = false
        var arrived: (lines: [String], text: String)
        var canBeStoredTo = true
        switch choices.below(10) {
        case 0, 1, 2: arrived = choices.percent(settings.generic) ? leaveOutThroughGenerics(declared, 90) : leaveOut(declared, 90)
        case 3:
            arrived = changeBehindAFixedName(declared, 90) ?? leaveOut(declared, 90)
            canBeStoredTo = false
        default:
            var from = drawPlainType()
            var given = sample(of: from)
            if !isScenesAlone, let type = annotations[v], type != .int32, !type.arms.contains(.int32), given == nil || choices.percent(40) { (from, given) = (type, name) }
            if given == nil { (from, given) = (.string, "\"given\"") }
            arrived = choices.percent(settings.generic) ? arriveThroughGenerics(given!, from, at: declared, 90) : arrive(given!, from, at: declared, 90)
        }
        isWithoutCasts = true
        var journey = choices.percent(20) ? [noteUse(of: "arrived", declared)] : writeJourney(of: "arrived", declared, site: site)
        isWithoutCasts = false
        // What is computed from the value goes back to where the value came from.
        if canBeStoredTo, arrived.text.hasSuffix("]") || arrived.text.hasSuffix(".held") || arrived.text.hasSuffix(".absent"), choices.percent(40), let changed = change("arrived", declared) {
            journey.insert("\(arrived.text) = \(changed);", at: 0)
        }
        let bystanders = addBystanders(to: journey, beside: "arrived")
        let body = arrived.lines + [choices.percent(70) ? "const arrived: \(declared.text) = \(arrived.text);" : "const arrived = \(arrived.text);"] + bystanders.statements
        let function = "accepted\(site)"
        let isGuardedInside = choices.percent(70)
        let caught = ["} catch (error) {", "    note((error as any)?.name);", "    \(Self.messageToStderr)", "}"]
        // The counter starts at what the caller gives.
        let (parameters, arguments, start) = choices.pick([
            ("", "", "0"), ("", "", "0"), ("", "", "0"), ("start: number", "0", "start"), ("start: number, unused: string[]", "0, []", "start"), ("start = 0", "", "start"),
            ("...starts: number[]", "0", "starts[0]"), ("from: { start: number }", "{ start: 0 }", "from.start"), ("unused: [], start: number", "[], 0", "start"),
        ])
        var inner = bystanders.declarations.map { $0 == "let tally = 0;" ? "let tally = \(start);" : $0 }
        inner += isGuardedInside ? ["try {"] + indented(body) + caught : body
        let turns = choices.pick([1, 1, 2, 3])
        let called = "\(function)(\(arguments))"
        let once: String
        // The function prints the bystanders, or the caller prints what it gets: a value, or what it reads out of a new list or a new object.
        switch choices.below(8) {
        case 0, 1:
            inner.append("return \(bystanders.end);")
            once = "note(\(called));"
        case 2:
            inner.append("return [\(bystanders.parts.joined(separator: ", "))];")
            once = choices.pick(["note(\(called)[0]);", "{ const got = \(called); note(got[got.length - 1]); note(got.length); }", "{ const [first, ...others] = \(called); note(first); note(others.length); }"])
        case 3:
            inner.append("return { first: \(bystanders.parts[0]), last: \(bystanders.parts[bystanders.parts.count - 1]), all: [\(bystanders.parts.joined(separator: ", "))] };")
            once = choices.pick(["note(\(called).last);", "{ const got = \(called); note(got.first); note(got.all[got.all.length - 1]); }", "{ const { first, all } = \(called); note(first); note(all.length); }"])
        case 4:
            inner.append("return [\(bystanders.parts[0]) + 0.5];")
            once = "note(\(called)[0]);"
        default:
            inner.append("note(\(bystanders.end));")
            once = "\(called);"
        }
        // How often the compiler expects the function to run follows from where its calls stand and how many there are.
        var calls = ["for (let turn = 0; turn < \(turns); turn++) \(once)"]
        switch choices.below(10) {
        case 0, 1: if turns == 1 { calls = [once] }
        case 2: calls = ["for (let turn = 0; turn < \(turns); turn++) for (let again = 0; again < 2; again++) \(once)"]
        case 3: calls = Array(repeating: once, count: 4)
        case 4: calls = ["[\(Array(repeating: "0", count: turns).joined(separator: ", "))].forEach(() => { \(once) });"]
        default: break
        }
        var lines = ["function \(function)(\(parameters)) {"] + indented(inner) + ["}"]
        lines += isGuardedInside ? calls : ["try {"] + indented(calls) + caught
        helpers.insert("note")
        return ["{"] + indented(lines) + ["}"]
    }

    /// A function of its own that takes values of every kind as a declared type.
    fileprivate func sceneBehindDeclaration(of v: Variable, named name: String, at index: Int) -> [String] {
        let site = v.number
        let takesFunction = choices.percent(15)
        let first = takesFunction ? drawFunctionType() : drawPlainType()
        let second = drawPlainType()
        let hasSecond = choices.percent(40)
        var body = [String]()
        let kind = choices.below(6)
        sceneIsAsync = kind == 2
        switch choices.below(hasSecond && !isScenesAlone ? 5 : 4) {
        case 0, 1: body = writeJourney(of: "value", first, site: site)
        case 2: body = writeLateArrival(of: "value", first) ?? writeJourney(of: "value", first, site: site)
        case 3:
            body = [compareOnly("value", first)] + writeJourney(of: "value", first, site: site)
        default:
            body = writeStatements(on: Subject(text: "other", type: second, isConstant: true, index: index))
            body += [noteUse(of: "value", first), noteUse(of: "other", second)]
        }
        if hasSecond, choices.percent(50) { body += writeJourney(of: "other", second, site: site, firstStep: 10) }
        if choices.percent(40) {
            let bystanders = addBystanders(to: body, beside: "value")
            body = bystanders.declarations + bystanders.statements + ["note(\(bystanders.end));"]
        }
        let gaps = body.indices.filter { !body[$0].hasPrefix(" ") && !body[$0].hasPrefix("}") && !body[$0].hasPrefix("else") } + [body.count]
        if kind == 2 { body.insert("await null;", at: choices.pick(gaps)) }
        if kind == 3 { body.insert("yield 1;", at: choices.pick(gaps)) }
        let guarded = choices.percent(75)
        var lines = ["{"]
        let parameters = "value: \(first.text)\(hasSecond ? ", other: \(second.text)" : "")"
        let function = "scene\(site)"
        switch kind {
        case 2: lines.append("    async function \(function)(\(parameters)): Promise<void> {")
        case 3: lines.append("    function* \(function)(\(parameters)): Generator<number, void, unknown> {")
        case 4: lines.append("    const \(function) = (\(parameters)): void => {")
        default: lines.append("    function \(function)(\(parameters)): void {")
        }
        if guarded { lines.append("        try {") }
        lines += body.map { "\(guarded ? "            " : "        ")\($0)" }
        if guarded { lines += ["        } catch (error) {", "            note((error as any)?.name);", "            \(Self.messageToStderr)", "        }"] }
        lines.append(kind == 4 ? "    };" : "    }")
        var given = isScenesAlone ? [] : [name]
        for _ in 0..<(1 + choices.below(4)) { given.append(choices.pick(takesFunction && choices.percent(70) ? Self.functionsOfEveryKind : Self.valuesOfEveryKind)) }
        if let right = sample(of: first), choices.percent(60) { given.insert(right, at: 0) }
        let others = given.reversed().map { $0 }
        if guarded, !hasSecond, kind != 2, kind != 3, choices.percent(40) {
            lines += ["    for (const given of [\(given.joined(separator: ", "))] as any[]) \(function)(given);", "}"]
            helpers.insert("note")
            return lines
        }
        for (i, value) in given.enumerated() {
            let call = "\(function)((\(value)) as any\(hasSecond ? ", (\(others[i])) as any" : ""))"
            switch kind {
            case 2: lines.append("    \(call).catch(() => note(\"rejected\"));")
            case 3: lines.append("    try { note([...\(call)]); } catch (error) { note(\"threw\"); \(Self.messageToStderr) }")
            default: lines.append(guarded ? "    \(call);" : "    try { \(call); } catch (error) { note(\"threw\"); \(Self.messageToStderr) }")
            }
        }
        lines.append("}")
        helpers.insert("note")
        return lines
    }
}

extension ILType {
    fileprivate var orAnything: ILType { self == .nothing ? .jsAnything : self }
}

// MARK: Programs that are refused whatever their types are

/// Throws for a program that stores to a built-in or to a member of one, that names a private member outside the class
/// that declares it or declares one twice, that calls `super()` in a class without a base class, or that has a regular
/// expression with the flag `v`, whose patterns Fuzzilli doesn't write.
/// Whether a `*`, `+`, `?` or `{n}` in the pattern follows nothing that can be repeated.
private func repeatsNothing(_ pattern: String) -> Bool {
    let characters = Array(pattern)
    var canRepeat = false
    var isInClass = false
    var i = 0
    while i < characters.count {
        let c = characters[i]
        i += 1
        if isInClass {
            if c == "\\" { i += 1 }
            if c == "]" { (isInClass, canRepeat) = (false, true) }
            continue
        }
        switch c {
        case "\\":
            canRepeat = i < characters.count && characters[i] != "b" && characters[i] != "B"
            i += 1
        case "[": isInClass = true
        case "(":
            canRepeat = false
            if i < characters.count, characters[i] == "?" {
                i += 1
                while i < characters.count, !":=!>".contains(characters[i]) { i += 1 }
                i += 1
            }
        case "|", "^", "$": canRepeat = false
        case "*", "+", "?":
            if !canRepeat { return true }
            canRepeat = false
            if i < characters.count, characters[i] == "?" { i += 1 }
        case "{":
            var end = i
            while end < characters.count, characters[end].isNumber || characters[end] == "," { end += 1 }
            guard end > i, end < characters.count, characters[end] == "}", characters[i].isNumber else {
                canRepeat = true
                continue
            }
            if !canRepeat { return true }
            canRepeat = false
            i = end + 1
            if i < characters.count, characters[i] == "?" { i += 1 }
        default: canRepeat = true
        }
    }
    return false
}

func rejectProgramThatCannotBuild(_ program: Program, in environment: JavaScriptEnvironment) throws {
    var builtins = Set<Variable>()
    var strings = Set<Variable>()
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
        case .loadString: strings.insert(instr.output)
        case .setProperty, .updateProperty, .setElement, .updateElement, .setComputedProperty, .updateComputedProperty:
            if builtins.contains(instr.input(0)) { throw InternalError.postProcessRejection("a store to a member of a built-in") }
            let name = (instr.op as? SetProperty)?.propertyName ?? (instr.op as? UpdateProperty)?.propertyName
            if name == "length", strings.contains(instr.input(0)) { throw InternalError.postProcessRejection("a store to the length of a string") }
        case .callSuperConstructor:
            if classesHaveBases.last != true { throw InternalError.postProcessRejection("super() without a base class") }
        case .loadRegExp(let op):
            if op.flags.contains(.unicodeSets) { throw InternalError.postProcessRejection("a regular expression with the flag v") }
            if repeatsNothing(op.pattern) { throw InternalError.postProcessRejection("a regular expression that repeats nothing") }
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
