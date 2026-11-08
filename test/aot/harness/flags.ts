export const compileCommand = ["build", "--compile", "--aot"] as const;

export const buildFlags = {
  eraseTypes: "--aot-erase-types",
  ownChecks: "--aot-check=Validate",
  withoutExecutable: "--aot-testing=NoExecutable",
  hugeHeap: "--aot-huge-heap",
  trim: "--trim",
  obfuscate: "--obfuscate",
  withoutFunctionSource: "--no-compile-function-source",
  withoutBuiltinModules: "--no-builtin-modules",
} as const;

export const withThreads = (count: number) => `--aot-threads=${count}`;
export const withProgramOutput = (path: string) => `--aot-out=${path}`;
export const withCarrier = (path: string) => ["--compile-executable-path", path];

// testaot starts from the engine's defaults. A build without further flags changes these: fill_record() in src/aot/engine.rs.
export const wordsOfAPlainBuild = ["references=narrow", "exclude=CodeOutsideImage,LibraryText"] as const;

export const buildEnvironment = {
  mapFilePath: "BUN_JSC_aotMapFilePath",
  logsPhaseTimes: "BUN_JSC_logAOTPhaseTimes",
} as const;

export const runtimeEnvironment = {
  forbidsInterpreter: "BUN_JSC_crashIfInterpreterIsUsed",
  countsPath: "BUN_JSC_aotCountsPath",
  logsModules: "BUN_AOT_VERBOSE",
} as const;

export const isDeveloperFlag = (flag: string) => flag.startsWith("--aot-");
