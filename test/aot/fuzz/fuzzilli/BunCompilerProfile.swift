// The profile for `bun build --compile --aot`. README.md beside this file says how to build and run it.

import Foundation

/// Where each instance of Bun writes the program it is compiling. The folder has to exist.
private let entryPoint = ProcessInfo.processInfo.environment["BUN_FUZZILLI_ENTRY_POINT"] ?? "/tmp/program.js"

/// Fuzzilli gives Bun no variable of its own environment but these.
private let inheritedEnvironment = ProcessInfo.processInfo.environment.filter { name, _ in
    name.hasPrefix("BUN_FUZZILLI_") || ["ASAN_SYMBOLIZER_PATH", "HOME"].contains(name)
}

/// Names of code generators, separated by commas.
private let disabledByTheEnvironment = (ProcessInfo.processInfo.environment["BUN_FUZZILLI_DISABLED_GENERATORS"] ?? "")
    .split(separator: ",").map(String.init)

let bunCompilerProfile = Profile(
    processArgs: { randomize in
        var args = [
            "build",
            "--compile",
            "--aot",
            "--aot-threads=1",
            // `bun run` prints a function's text as its transpiler wrote it. Bun hides the text in both runs.
            "--no-compile-function-source",
        ]
        // A program that uses Bun's own modules compiles them too, and checking those takes most of the time.
        if ProcessInfo.processInfo.environment["BUN_FUZZILLI_CHECKS_PASSES"] != "0" {
            args += ["--aot-validate", "--aot-verify-each-pass"]
        }
        if randomize {
            if probability(0.2) { args.append("--aot-heat=everything-is-hot") }
            else if probability(0.2) { args.append("--aot-heat=everything-is-cold") }
            // The same text has to print the same when the compiler doesn't read its types.
            if TypeScriptSettings.fromEnvironment != nil && probability(0.15) { args.append("--aot-erase-types") }
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

    additionalCodeGenerators: bunCodeGenerators + bunCallbackGenerators + (TypeScriptSettings.fromEnvironment == nil ? [] : typeScriptCodeGenerators),

    additionalProgramTemplates: WeightedList<ProgramTemplate>([]),

    // A compiled program can't replace a built-in, and a built-in named here can be a call of require().
    disabledCodeGenerators: ["BuiltinOverwriteGenerator"] + disabledByTheEnvironment
        + (TypeScriptSettings.fromEnvironment == nil ? [] : ["WithStatementGenerator"]),

    // They read what the program writes with fuzzilli('FUZZILLI_PRINT', ..), which a compiled program doesn't have.
    disabledMutators: ["ExplorationMutator", "ProbingMutator"],

    additionalBuiltins: [
        // Bun puts its declaration in front of every program.
        "printValue": .function([.string, .jsAnything] => .undefined)
    ].merging(BunBuiltins.builtins) { ours, _ in ours },

    additionalObjectGroups: BunBuiltins.objectGroups,

    additionalEnumerations: [],

    additionalOptionsBags: [],

    optionalPostProcessor: PostProcessors(
        all: ([
            GuardsOutsideFunctions.share == nil ? nil : GuardsOutsideFunctions(),
            // Behind the guards, so that these scenes have none.
            ScenesOfStores.share == nil ? nil : ScenesOfStores(),
            TypeScriptSettings.fromEnvironment == nil ? ProgramsThatCanBuild() : TypeScriptSeeds(),
        ] as [FuzzingPostProcessor?]).compactMap { $0 })
)
