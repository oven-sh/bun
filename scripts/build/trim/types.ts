export type FeatureName = string;
export type ObjectFormat = "elf" | "macho" | "coff";
export type StubKind = "Abort" | "Throw" | "ReturnUndefined" | "ReturnDefault";
export type EnteredFrom = "program" | "startup" | "command-line";

export const objectFormats = ["elf", "macho", "coff"] as const satisfies readonly ObjectFormat[];
export const stubKinds = ["Abort", "Throw", "ReturnUndefined", "ReturnDefault"] as const satisfies readonly StubKind[];
export const enteredFromValues = ["program", "startup", "command-line"] as const satisfies readonly EnteredFrom[];

export const firstEmbedderFeatureIndex = 128;
export const featureIndexLimit = 512;
export const trimFeatureLimit = 256;

export interface Feature {
  name: FeatureName;
  rustName: string;
  index: number;
  text: string;
  enteredFrom: EnteredFrom;
  isEngine: boolean;
  minimumBytes: Partial<Record<ObjectFormat, number>>;
  exports: boolean;
  cFunctions?: string[];
  cxxFunctions?: CxxFunctionPattern[];
}

export interface CxxFunctionPattern {
  hint: string;
  pattern: string;
}

export interface TrimFeature {
  name: string;
  rustName: string;
  features: FeatureName[];
  about: string;
  also: string[];
  saves?: { linux: number; macos: number };
}

export interface IcuDataLine {
  itemClass: string;
  exceptWindows: boolean;
  byLocale: boolean;
  features: FeatureName[];
}

export interface FeatureModel {
  features: Feature[];
  trimFeatures: TrimFeature[];
  icuData: IcuDataLine[];
  icuLanguageGroups: string[][];
  hash: bigint;
}

export type BuiltinKind =
  | "Function"
  | "Method"
  | "Constructor"
  | "Namespace"
  | "Accessor"
  | "DataProperty"
  | "Constant"
  | "Prototype"
  | "NativeBinding"
  | "Module"
  | "InternalModule";

export const builtinKinds = [
  "Function",
  "Method",
  "Constructor",
  "Namespace",
  "Accessor",
  "DataProperty",
  "Constant",
  "Prototype",
  "NativeBinding",
  "Module",
  "InternalModule",
] as const satisfies readonly BuiltinKind[];

export interface BuiltinFeatureUse {
  feature: FeatureName;
  isConditional: boolean;
}

export interface BuiltinEntry {
  id: number;
  path: string;
  kind: BuiltinKind;
  uses: BuiltinFeatureUse[];
  nativeSymbols: string[];
  creationSymbol?: string;
  hasHiddenRoot: boolean;
}

export interface BuiltinUses {
  entries: BuiltinEntry[];
  /** The id of each built-in that code of the engine names, at its position in the engine's list of names. */
  namedByEngine?: number[];
}

/** BuiltinNamedByEngine: the record has a position in `namedByEngine`. Who reads the records makes a Builtin of it. */
export type GuardOrigin = "NativeCode" | "Builtin" | "Definition" | "BuiltinNamedByEngine";

export const guardOrigins = [
  "NativeCode",
  "Builtin",
  "Definition",
  "BuiltinNamedByEngine",
] as const satisfies readonly GuardOrigin[];

export interface EntryPoint {
  guard: number;
  entry: number;
  feature: number;
  stub: StubKind;
  origin: GuardOrigin;
  builtin: number | undefined;
  entrySection: string;
}

export const EdgeKind = { Ordinary: 0, Guarded: 1, Unguarded: 2, Soft: 3 } as const;

export type EdgeStrength = "Reference" | "AbortingGuard" | "RecoverableGuard";

export const edgeStrengths = [
  "Reference",
  "AbortingGuard",
  "RecoverableGuard",
] as const satisfies readonly EdgeStrength[];

export interface FeatureEdge {
  from: number;
  to: number;
  strength: EdgeStrength;
  isFollowed: boolean;
}

export interface Group {
  set: number;
  bytes: number;
}

export type PartitionFailure =
  | { kind: "EntryPointReferencedByRetainedCode"; entry: number; referrer: number | undefined; features: number[] }
  | { kind: "GuardWithoutReference"; guard: number; entry: number; feature: number }
  | { kind: "FeatureBelowMinimum"; feature: number; bytes: number; minimum: number };

export interface Partition {
  isRoot: Uint8Array;
  isRetained: Uint8Array;
  exactSetOf: Uint32Array;
  setOf: Uint32Array;
  sets: number[][];
  edgeKind: Uint8Array;
  seeds: Map<number, number[]>;
  foldedEntryPoints: EntryPoint[];
  edges: FeatureEdge[];
  layoutRank: Uint16Array;
  groups: Group[];
  groupOfSet: Map<number, number>;
  removableBytes: Map<number, number>;
  featuresNearMinimum: number[];
  unexplainedBytes: number;
  failures: PartitionFailure[];
}

export type DeclaredUseFailure =
  | { kind: "GuardOfUnknownBuiltin"; builtin: number; guard: number; entry: number; feature: number }
  | { kind: "UndeclaredUse"; builtin: number; entry: number; feature: number }
  | { kind: "UseWithoutGuard"; builtin: number; feature: number }
  | { kind: "GuardWithoutUser"; guard: number; entry: number; feature: number };

export interface RemovableRange {
  start: number;
  end: number;
  set: number;
  isCode: boolean;
  canBeCut: boolean;
  canBeFilled: boolean;
}

export interface IcuItemRun {
  firstItem: number;
  itemCount: number;
  set: number;
  localeGroup: number | undefined;
}

export interface IcuPackage {
  start: number;
  end: number;
  runs: IcuItemRun[];
}

export interface IcuLanguage {
  name: string;
  group: number;
}

export interface ModuleTextRange {
  start: number;
  end: number;
  module: number;
  set: number;
  readers: number[];
  canBeCut: boolean;
  canBeFilled: boolean;
}

export interface ModuleText {
  start: number;
  end: number;
  module: number;
  set: number;
  readers: number | undefined;
  canBeCut: boolean;
  canBeFilled: boolean;
}

export interface TrimTable {
  featuresHash: bigint;
  baseAddress: number;
  edges: FeatureEdge[];
  sets: number[][];
  ranges: RemovableRange[];
  icuPackages: IcuPackage[];
  icuLanguages: IcuLanguage[];
  moduleTexts: ModuleText[];
}
