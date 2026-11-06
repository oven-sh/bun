export type ReportDetail = "summary" | "functions" | "sites";

export const compileCommand = ["build", "--compile", "--aot"] as const;

export const buildFlags = {
  eraseTypes: "--aot-erase-types",
  validate: "--aot-validate",
  verifyEachPass: "--aot-check=verify-each-pass",
  validateBackEnd: "--aot-check=validate-back-end",
  withoutFlowResults: "--aot-disable=flow-results",
  withoutPredictions: "--aot-testing=ignore-predictions",
  hugeHeap: "--aot-huge-heap",
  trim: "--trim",
  obfuscate: "--obfuscate",
  withoutFunctionSource: "--no-compile-function-source",
  withoutBuiltinModules: "--no-builtin-modules",
  listRegistry: "--aot-list=registry",
} as const;

export const withoutFlowResult = (flowResult: string) => `--aot-disable=flow:${flowResult}`;
export const withoutPass = (pass: string) => `--aot-disable=pass:${pass}`;
export const withLimit = (limit: string, value: number) => `--aot-limit=${limit}:${value}`;
export const withThreads = (count: number) => `--aot-threads=${count}`;
export const withLayoutSeed = (seed: number) => `--aot-layout-seed=${seed}`;
export const withProgramOutput = (path: string) => `--aot-out=${path}`;
export const withReport = (path: string, detail: ReportDetail) => [`--aot-report=${path}`, `--aot-report-detail=${detail}`];
export const withCarrier = (path: string) => ["--compile-executable-path", path];

export const buildEnvironment = {
  mapFilePath: "BUN_JSC_aotMapFilePath",
  logsPhaseTimes: "BUN_JSC_logAOTPhaseTimes",
  dumpsB3Graph: "BUN_JSC_dumpAOTB3Graph",
  dumpsDisassembly: "BUN_JSC_dumpAOTDisassembly",
  functionToDump: "BUN_JSC_aotFunctionToDump",
} as const;

export const runtimeEnvironment = {
  countsPath: "BUN_JSC_aotCountsPath",
  forbidsInterpreter: "BUN_JSC_crashIfInterpreterIsUsed",
  logsModules: "BUN_AOT_VERBOSE",
} as const;

export const isDeveloperFlag = (flag: string) => flag.startsWith("--aot-");
