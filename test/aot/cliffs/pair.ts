export type VariantName = "base" | "trigger";
export const variantNames: readonly VariantName[] = ["base", "trigger"];

export type LineRole = "shared" | "touched" | "base" | "trigger";

export const lineMarkers: Record<Exclude<LineRole, "shared">, string> = {
  touched: "// touched",
  base: "// base",
  trigger: "// trigger",
};

export type Relation =
  | { kind: "same" }
  | { kind: "atMostMore"; slack: number }
  | { kind: "atMostFewer"; slack: number }
  | { kind: "atMostTimes"; ratio: number }
  | { kind: "equals"; value: number }
  | { kind: "atMost"; value: number }
  | { kind: "atLeast"; value: number };

export type Expectation =
  | { kind: "code"; function: string }
  | { kind: "count"; function: string; operations: string[]; relation: Relation }
  | { kind: "bytes"; function: string; relation: Relation }
  | { kind: "statistic"; name: string; relation: Relation }
  | { kind: "limit"; name: string; relation: Relation }
  | { kind: "loss"; relation: Relation }
  | { kind: "counter"; name: string; relation: Relation }
  | { kind: "calls"; operation: string | null; relation: Relation }
  | { kind: "printed"; name: string; relation: Relation }
  | { kind: "instructions"; relation: Relation }
  | { kind: "executable"; relation: Relation }
  | { kind: "image"; relation: Relation }
  | { kind: "features"; relation: Relation }
  | { kind: "diagnostic"; code: string; relation: Relation }
  | { kind: "buildInstructions"; relation: Relation };

export type ExpectationKind = Expectation["kind"];

export const directiveNames: Record<ExpectationKind, string> = {
  code: "CODE",
  count: "COUNT",
  bytes: "BYTES",
  statistic: "STATISTIC",
  limit: "LIMIT",
  loss: "LOSS",
  counter: "COUNTER",
  calls: "CALLS",
  printed: "PRINTED",
  instructions: "INSTRUCTIONS",
  executable: "EXECUTABLE",
  image: "IMAGE",
  features: "FEATURES",
  diagnostic: "DIAGNOSTIC",
  buildInstructions: "BUILD-INSTRUCTIONS",
};

export const settingNames = ["CLIFF", "FLAGS", "BASE-FLAGS", "TRIGGER-FLAGS", "TRIGGER-BUILD", "ARGUMENTS", "PLATFORM", "SITES"] as const;
export type SettingName = (typeof settingNames)[number];

export type Platform = "linux" | "darwin" | "win32" | "x64" | "arm64";

export interface PairSettings {
  id: string;
  flags: Record<VariantName, string[]>;
  arguments: string[];
  platforms: Platform[];
  checksSites: boolean;
  triggerBuildFails: boolean;
}

export interface Variant {
  name: VariantName;
  files: Record<string, string>;
  flags: string[];
}

export interface Pair {
  path: string;
  entryPoint: string;
  settings: PairSettings;
  expectations: Expectation[];
  variants: Record<VariantName, Variant>;
  lineRoles: Map<string, LineRole[]>;
}

export type GeneratePair = () => Record<string, string>;

export const generatorSuffix = ".generate.ts";
export const todoSuffix = ".todo.txt";
export const moduleBodyName = "<module>";
export const variantFilePattern = /\.(base|trigger)(\.[^./\\]+)$/;

export type CliffScope = "program" | "process" | "module" | "layout" | "callers" | "function" | "site" | "value";
export type CliffHome = "pairs" | "test" | "engine";

export interface CatalogEntry {
  id: string;
  path: string;
  families: string[];
  scope: CliffScope;
  home: CliffHome;
}

export const cliffCount = 411;
export const cliffId = (number: number) => `C${String(number).padStart(3, "0")}`;

export interface Finding {
  pair: string;
  expectation: string;
  message: string;
}
