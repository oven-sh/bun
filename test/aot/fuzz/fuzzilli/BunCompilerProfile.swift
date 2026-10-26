// The profile for `bun build --compile --aot`. README.md beside this file says how to build and run it.

import Foundation

/// Where each instance of Bun writes the program it is compiling. The folder has to exist.
private let entryPoint = ProcessInfo.processInfo.environment["BUN_FUZZILLI_ENTRY_POINT"] ?? "/tmp/program.js"

/// Fuzzilli gives Bun no variable of its own environment but these.
private let inheritedEnvironment = ProcessInfo.processInfo.environment.filter { name, _ in
    ["ASAN_SYMBOLIZER_PATH", "BUN_FUZZILLI_CPU_SECONDS", "BUN_FUZZILLI_MEMORY_MEGABYTES", "HOME"].contains(name)
}

let bunCompilerProfile = Profile(
    processArgs: { randomize in
        var args = [
            "build",
            "--compile",
            "--aot",
            "--aot-validate",
            "--aot-verify-each-pass",
            "--aot-threads=1",
        ]
        if randomize {
            if probability(0.2) { args.append("--aot-heat=everything-is-hot") }
            else if probability(0.2) { args.append("--aot-heat=everything-is-cold") }
        }
        args.append(entryPoint)
        return args
    },

    processArgsReference: nil,

    processEnv: [
        "ASAN_OPTIONS": "abort_on_error=1:detect_leaks=0:allocator_may_return_null=1:allow_user_segv_handler=1:symbolize=1",
        "UBSAN_OPTIONS": "abort_on_error=1:print_stacktrace=1",
        "BUN_ENABLE_CRASH_REPORTING": "0",
        "BUN_DEBUG_QUIET_LOGS": "1",
        "BUN_JSC_useJIT": "0",
        "DO_NOT_TRACK": "1",
        "NO_COLOR": "1",
    ].merging(inheritedEnvironment) { _, inherited in inherited },

    // Each program is compiled in a process of its own, so nothing piles up in the one that Fuzzilli starts.
    maxExecsBeforeRespawn: 100_000,

    // Bun ends a build by itself after BUN_FUZZILLI_CPU_SECONDS of processor time. This bound is for a busy machine.
    timeout: Timeout.value(120_000),

    codePrefix: """
        """,

    codeSuffix: """
        """,

    ecmaVersion: ECMAScriptVersion.es6,

    startupTests: [
        ("fuzzilli('FUZZILLI_CRASH', 0)", .shouldCrash)
    ],

    additionalCodeGenerators: [],

    additionalProgramTemplates: WeightedList<ProgramTemplate>([]),

    disabledCodeGenerators: [],

    // They learn from a run, and nothing runs.
    disabledMutators: ["ExplorationMutator", "ProbingMutator"],

    additionalBuiltins: [:],

    additionalObjectGroups: [],

    additionalEnumerations: [],

    additionalOptionsBags: [],

    optionalPostProcessor: nil
)
