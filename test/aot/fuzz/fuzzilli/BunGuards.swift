import Foundation

/// BUN_FUZZILLI_GUARDS=<percent>: in that share of the programs, every operation outside functions that can have a guard gets one.
/// A program that is only stored has never run. Most such programs end at a statement that throws, and the statements behind it don't run.
struct GuardsOutsideFunctions: FuzzingPostProcessor {
    static let share = Double(ProcessInfo.processInfo.environment["BUN_FUZZILLI_GUARDS"] ?? "").map { $0 / 100 }

    func process(_ program: Program, for fuzzer: Fuzzer) throws -> Program {
        guard probability(Self.share ?? 0) else { return program }
        let b = fuzzer.makeBuilder(forMutating: program)
        b.adopting {
            for instr in program.code {
                if let op = instr.op as? GuardableOperation, !op.isGuarded, !b.context.contains(.subroutine) {
                    b.adopt(Instruction(op.withGuardedState(true), inouts: instr.inouts))
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

struct PostProcessors: FuzzingPostProcessor {
    let all: [FuzzingPostProcessor]

    func process(_ program: Program, for fuzzer: Fuzzer) throws -> Program {
        try all.reduce(program) { try $1.process($0, for: fuzzer) }
    }
}
