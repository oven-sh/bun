import Foundation

private func shareOfPrograms(_ name: String) -> Double? {
    Double(ProcessInfo.processInfo.environment[name] ?? "").map { $0 / 100 }
}

/// BUN_FUZZILLI_GUARDS=<percent>: in that share of the programs, every operation outside functions that can have a guard gets one.
/// BUN_FUZZILLI_TRY_BLOCKS=<percent>: in that share of the programs with guards, every other statement at the top level that can throw gets a try block of its own.
/// A program that is only stored has never run. Most such programs end at a statement that throws, and the statements behind it don't run.
struct GuardsOutsideFunctions: FuzzingPostProcessor {
    static let share = shareOfPrograms("BUN_FUZZILLI_GUARDS")
    static let shareWithTryBlocks = shareOfPrograms("BUN_FUZZILLI_TRY_BLOCKS")

    func process(_ program: Program, for fuzzer: Fuzzer) throws -> Program {
        guard probability(Self.share ?? 0) else { return program }
        let addsTryBlocks = probability(Self.shareWithTryBlocks ?? 0)
        let b = fuzzer.makeBuilder(forMutating: program)
        b.adopting {
            var first = 0
            while first < program.size {
                let statement = program.code[first...lastInstruction(ofStatementAt: first, in: program.code)]
                if addsTryBlocks && canThrow(statement) {
                    adoptInTryBlock(statement, into: b)
                } else {
                    for instr in statement { adoptWithGuard(instr, into: b) }
                }
                first = statement.endIndex
            }
        }
        let result = b.finalize()
        result.contributors = program.contributors
        result.comments = program.comments
        return result
    }

    private func adoptWithGuard(_ instr: Instruction, into b: ProgramBuilder) {
        if let op = instr.op as? GuardableOperation, !op.isGuarded, !b.context.contains(.subroutine) {
            b.adopt(Instruction(op.withGuardedState(true), inouts: instr.inouts))
        } else {
            b.adopt(instr)
        }
    }

    /// What the statement defines stays visible behind the block: `let v5 = undefined; try { v5 = v3.a; } catch(e6) {}`.
    private func adoptInTryBlock(_ statement: Slice<Code>, into b: ProgramBuilder) {
        var defined = [Variable]()
        forEachInstruction(of: statement) { instr, depth in
            if depth == 0 { defined += instr.outputs }
        }
        let visible = defined.map { _ in b.loadUndefined() }
        b.buildTryCatchFinally(
            tryBody: {
                for instr in statement { adoptWithGuard(instr, into: b) }
                for (inner, outer) in zip(defined, visible) { b.reassign(variable: outer, value: b.adopt(inner)) }
            }, catchBody: { _ in })
        for (inner, outer) in zip(defined, visible) { b.setAdoptionMap(for: inner, to: outer) }
    }

    private func lastInstruction(ofStatementAt first: Int, in code: Code) -> Int {
        var depth = 0
        for index in first..<code.count {
            if code[index].isBlockEnd { depth -= 1 }
            if code[index].isBlockStart { depth += 1 }
            if depth == 0 { return index }
        }
        return code.count - 1
    }

    /// The depth of the instructions that begin, divide and end the statement is 0.
    private func forEachInstruction(of statement: Slice<Code>, _ body: (Instruction, Int) -> Void) {
        var depth = 0
        for instr in statement {
            if instr.isBlockEnd { depth -= 1 }
            body(instr, depth)
            if instr.isBlockStart { depth += 1 }
        }
    }

    private func canThrow(_ statement: Slice<Code>) -> Bool {
        let first = statement.first!
        if first.op is GuardableOperation || first.op is BeginAnySubroutine { return false }
        switch first.op.opcode {
        case .loadInteger, .loadBigInt, .loadFloat, .loadString, .loadBoolean, .loadUndefined, .loadNull, .loadThis, .loadRegExp,
            .createArray, .createIntArray, .createFloatArray, .typeOf, .void, .dup, .reassign, .ternaryOperation, .nop, .directive,
            .beginCodeString:
            return false
        case .createNamedVariable(let op):
            // A declaration in a block would end with the block.
            return op.declarationMode == .global
        case .beginClassDefinition(let op):
            return op.hasSuperclass || runsCodeWhenDefined(statement)
        case .beginObjectLiteral:
            return runsCodeWhenDefined(statement)
        default:
            return true
        }
    }

    private func runsCodeWhenDefined(_ literalOrClass: Slice<Code>) -> Bool {
        var found = false
        forEachInstruction(of: literalOrClass) { instr, depth in
            guard depth == 1 else { return }
            if instr.op.name.contains("Computed") || instr.op is ObjectLiteralCopyProperties || instr.op is BeginClassStaticInitializer {
                found = true
            }
        }
        return found
    }
}

/// A program that the compiler refuses costs a second build of its whole batch.
struct ProgramsThatCanBuild: FuzzingPostProcessor {
    func process(_ program: Program, for fuzzer: Fuzzer) throws -> Program {
        try rejectProgramThatCannotBuild(program, in: fuzzer.environment)
        return program
    }
}

struct PostProcessors: FuzzingPostProcessor {
    let all: [FuzzingPostProcessor]

    func process(_ program: Program, for fuzzer: Fuzzer) throws -> Program {
        try all.reduce(program) { try $1.process($0, for: fuzzer) }
    }
}
