import type { TargetArchitecture } from "./model.ts";
import type {
  BuiltinKind,
  BuiltinPath,
  CalledFunctionSpec,
  CallMode,
  Capability,
  ClassColumns,
  ClassName,
  EntryColumns,
  FeatureName,
  FunctionRef,
  HostCallSpec,
  HostObjectFieldSpec,
  HostObjectInternalFieldSpec,
  HostReadContext,
  HostUseSpec,
  HostValueSpec,
  IntrinsicPosition,
  IntrinsicSpec,
  LayoutName,
  ModuleLoadSpec,
  NativeCallerSpec,
  NativeCallKind,
  NativeMentionSpec,
  Origin,
  ParameterType,
  Scope,
  SignatureColumns,
  StaticTableRef,
  TargetPlatform,
  TypeSpec,
} from "./vocabulary.ts";

export const proofs = ["Structure", "ByConstruction", "HandWritten"] as const;
export type Proof = (typeof proofs)[number];

export interface Source {
  file: string;
  line: number | null;
  origin: Origin;
  proof: Proof;
}

export interface ParameterDeclaration {
  name: string;
  type: ParameterType;
}

export interface ResultPropertyDeclaration {
  name: string;
  type: TypeSpec;
}

export interface PlatformResultDeclaration {
  platform: TargetPlatform;
  result: TypeSpec;
}

export interface SignatureDeclaration extends SignatureColumns {
  mode: CallMode;
  receiver: ParameterType | null;
  parameters: readonly ParameterDeclaration[];
  result: TypeSpec;
  /** What the result is in an executable for each platform, where that says more than `result`, which is all of them together. */
  resultsByPlatform?: readonly PlatformResultDeclaration[];
  resultProperties?: readonly ResultPropertyDeclaration[];
  prefixProperties?: readonly ResultPropertyDeclaration[];
  capability: Capability;
  throws: boolean;
  /** It throws, and it has no step of its own that does: see b.propagated. */
  onlyPropagatesErrors?: boolean;
  isUndeclared: boolean;
}

export type DispatchDeclaration =
  { signature: number } | { argument: number; branches: readonly { tested: TypeSpec; then: DispatchDeclaration }[] };

export interface ModeDispatchDeclaration {
  mode: CallMode;
  root: DispatchDeclaration;
}

export interface TargetTextSpec {
  text: string;
  platforms: readonly TargetPlatform[];
  architectures: readonly TargetArchitecture[];
}

export type ConstantSpec =
  | { constant: "Number"; value: number; cppExpression: string | null }
  | { constant: "String"; texts: readonly TargetTextSpec[] }
  | { constant: "Symbol" }
  | { constant: "Undefined" };

export interface NamespaceDeclaration {
  declares: "Namespace";
  path: BuiltinPath;
  scope: Scope;
  isLocked: boolean;
  locksMembers: boolean;
  isGlobalObject: boolean;
  listsAllMembers: boolean;
  namesReadByNativeCode: readonly string[] | null;
  namesOnlyInspectedByNativeCode: readonly string[];
  columns: EntryColumns;
}

export interface StaticTableDeclaration {
  declares: "StaticTable";
  holder: BuiltinPath;
  table: StaticTableRef;
}

export interface ClassDeclaration {
  declares: "Class";
  path: BuiltinPath;
  name: ClassName;
  columns: ClassColumns;
  entryColumns: EntryColumns;
}

export interface MemberDeclaration {
  declares: "Member";
  path: BuiltinPath;
  kind: Exclude<BuiltinKind, "Namespace" | "Prototype" | "NativeBinding">;
  isOwnPropertyOfInstances: boolean;
  isLazilyCreated: boolean;
  signatures: readonly SignatureDeclaration[];
  dispatches: readonly ModeDispatchDeclaration[];
  constant: ConstantSpec | null;
  length: number | null;
  columns: EntryColumns;
}

export const symbolsNaming = ({ columns: { nativeSymbols = [], creationSymbol } }: MemberDeclaration): string[] =>
  creationSymbol === undefined ? [...nativeSymbols] : [...nativeSymbols, creationSymbol];

export interface ExtensionDeclaration {
  declares: "Extension";
  path: BuiltinPath;
  columns: EntryColumns;
}

export interface LayoutFieldDeclaration {
  name: string | null;
  isOptional: boolean;
  type: TypeSpec;
}

export interface LayoutDeclaration {
  declares: "Layout";
  name: LayoutName;
  isTuple: boolean;
  fields: readonly LayoutFieldDeclaration[];
}

export interface SameObjectDeclaration {
  declares: "SameObject";
  path: BuiltinPath;
  original: BuiltinPath;
}

export interface InheritanceDeclaration {
  declares: "Inheritance";
  path: BuiltinPath;
  prototype: BuiltinPath | null;
}

export interface NameDeclaration {
  declares: "Name";
  text: string;
}

export interface OwnPropertyDeclaration {
  name: string;
  isAccessor: boolean;
  isFixed: boolean;
  /** The host creates it in some runs only: with a flag of the command line, on the main thread. */
  isCreatedInSomeRuns: boolean;
}

export interface OwnPropertiesDeclaration {
  declares: "OwnProperties";
  holder: BuiltinPath;
  isOpen: boolean;
  properties: readonly OwnPropertyDeclaration[];
}

/** ModuleObject: the export is the object that `require` answers. Property: a property of that object holds it. Namespace: only the module namespace object holds it. */
export type ModuleExportHolder = "ModuleObject" | "Property" | "Namespace";

export interface ModuleExportDeclaration {
  name: string;
  holder: ModuleExportHolder;
  platforms: readonly TargetPlatform[];
}

export interface ModuleDeclaration {
  declares: "Module";
  specifier: string;
  registryId: number;
  registryField: string | null;
  hasSource: boolean;
  isEsModule: boolean;
  hasOpenNamespace: boolean;
  listsAllExports: boolean;
  isPublic: boolean;
  /** Whether `require` answers a function. null: nothing says. */
  isFunction: boolean | null;
  namespacePath: BuiltinPath | null;
  exports: readonly ModuleExportDeclaration[];
  exportsHeldByNamespace: readonly string[];
}

export const runtimeFunctionRoles = ["EngineBuiltin", "HostBuiltin", "CompilerFunction"] as const;
export type RuntimeFunctionRole = (typeof runtimeFunctionRoles)[number];

export interface RuntimeFunctionDeclaration {
  declares: "RuntimeFunction";
  id: number;
  role: RuntimeFunctionRole;
  function: FunctionRef;
  exportName: string;
  cppCodeName: string | null;
  isHiddenInStackTraces: boolean;
  isNeverInlined: boolean;
  platforms: readonly TargetPlatform[];
}

export interface NativeBindingDeclaration {
  declares: "NativeBinding";
  kind: NativeCallKind;
  file: string;
  symbol: string;
  hostNumber: number | null;
  /** Each evaluation makes a function. What is written at the path of the binding describes the calls of that function. */
  answersFunction: boolean;
  /** Native code makes the function and hands it to code of the library, which has no spelling for it. */
  isHandedByNativeCode?: boolean;
}

export interface NativeLoadDeclaration {
  declares: "NativeLoad";
  registryField: string;
  onBehalfOf: BuiltinPath | "Startup";
  exports: readonly string[] | null;
}

export interface NativeCallsDeclaration {
  declares: "NativeCalls";
  through: readonly string[];
  calls: readonly (FunctionRef | { function: FunctionRef; uses: readonly HostUseSpec[] })[];
  otherMentions: readonly NativeMentionSpec[];
  callers: readonly NativeCallerSpec[];
}

export interface IntrinsicDeclaration {
  declares: "Intrinsic";
  name: string;
  position: IntrinsicPosition;
  isPrefixedGlobal: boolean;
  meaning: IntrinsicSpec;
}

export interface ExcludedFunctionDeclaration {
  declares: "ExcludedFunction";
  function: FunctionRef;
}

export interface HandwrittenFileDeclaration {
  declares: "HandwrittenFile";
  file: string;
}

/** An entry of the host that hand-written code of the engine names. The engine declares it, so the host cannot leave it out or add one. */
export interface HostRoleDeclaration {
  declares: "HostRole";
  path: BuiltinPath;
}

export interface HostClassRoleDeclaration {
  declares: "HostClassRole";
  name: ClassName;
}

/** Where the roles point that a host leaves out. Bun declares none, so there a role without an entry stops the build. The host that WebKit's own programs are linked with declares one. */
export interface UnfilledHostRolesDeclaration {
  declares: "UnfilledHostRoles";
  path: BuiltinPath;
  class: ClassName;
}

/** What the table leaves out of a host, because the host is built without some of its parts or because not every build of it has them. */
export interface LeftOutDeclaration {
  declares: "LeftOut";
  /** Schemas that are not read, by file name. `$bindgen` of one has no entry. */
  schemas: readonly string[];
  /** Nothing is declared at one of these or under it. */
  paths: readonly BuiltinPath[];
  /** What `#if defined(NAME)` in a static table finds defined. */
  definedNames: readonly string[];
  /** Runtime modules that the lists of exports may name all the same. */
  modules: readonly string[];
  /** Whether other declarations may name what is left out. Then one that names what nothing declares says nothing. Otherwise it stops the build. */
  mayBeNamed: boolean;
}

/** A function that the front end of the host compiles, declared by a host that has no front end. */
export interface FrontEndFunctionDeclaration {
  declares: "FrontEndFunction";
  function: FunctionRef;
}

/** What of the engine an executable can be linked without, in the order of the numbers. */
export interface EngineFeaturesDeclaration {
  declares: "EngineFeatures";
  names: readonly FeatureName[];
}

/** What the host does with an export of a module of the program. It takes the forms that the front end has a record for. */
export type HostReadUse = Extract<HostUseSpec, { read: "Inspected" | "PassedTo" }> | { read: "Called" };

export interface HostReadDeclaration {
  declares: "HostRead";
  context: HostReadContext;
  exportName: string;
  use: HostReadUse;
}

/** An object that native code makes by itself and that lies in the native cell. One stands for all that are made. */
export interface HostObjectDeclaration {
  declares: "HostObject";
  cell: string;
  /** The entry that says what a call of the object does. null: it is no function. */
  function: BuiltinPath | null;
  prototype: BuiltinPath | null;
  fields: readonly HostObjectFieldSpec[];
  internalFields: readonly HostObjectInternalFieldSpec[];
  keepsStringsOfStoredValues: boolean;
}

/** What native code passes to a member that it finds under the name on an operand and calls. */
export interface NamedMemberCallDeclaration {
  declares: "NamedMemberCall";
  name: string;
  arguments: readonly HostValueSpec[];
}

/** Classes of the host, declared or not, have a native method under the name, and a call of one calls what lies in the cell. */
export interface HostMethodCallDeclaration {
  declares: "HostMethodCall";
  name: string;
  cell: string;
  call: HostCallSpec;
}

export interface StartupDeclaration {
  declares: "Startup";
  modules: readonly string[];
  loads: readonly ModuleLoadSpec[];
  functionsCalledWithLoads: readonly CalledFunctionSpec[];
  namesOfMethodsCallingLoads: readonly string[];
  moduleLoaderFunctions: readonly FunctionRef[];
}

export interface SeenCodeOnlyDeclaration {
  declares: "SeenCodeOnly";
  holders: readonly BuiltinPath[];
  nativeFiles: readonly string[];
}

export type Declaration =
  | NamespaceDeclaration
  | StaticTableDeclaration
  | ClassDeclaration
  | MemberDeclaration
  | ExtensionDeclaration
  | LayoutDeclaration
  | SameObjectDeclaration
  | InheritanceDeclaration
  | NameDeclaration
  | OwnPropertiesDeclaration
  | ModuleDeclaration
  | RuntimeFunctionDeclaration
  | NativeBindingDeclaration
  | NativeLoadDeclaration
  | NativeCallsDeclaration
  | IntrinsicDeclaration
  | ExcludedFunctionDeclaration
  | HandwrittenFileDeclaration
  | HostRoleDeclaration
  | UnfilledHostRolesDeclaration
  | LeftOutDeclaration
  | FrontEndFunctionDeclaration
  | EngineFeaturesDeclaration
  | HostClassRoleDeclaration
  | HostReadDeclaration
  | HostObjectDeclaration
  | NamedMemberCallDeclaration
  | HostMethodCallDeclaration
  | StartupDeclaration
  | SeenCodeOnlyDeclaration;

export interface SourcedDeclaration {
  declaration: Declaration;
  source: Source;
}

export const leftOutOf = (declarations: readonly SourcedDeclaration[]): LeftOutDeclaration[] =>
  declarations.flatMap(({ declaration }) => (declaration.declares === "LeftOut" ? [declaration] : []));

export class DeclarationFile {
  readonly declarations: readonly Declaration[];
  constructor(declarations: readonly Declaration[]) {
    this.declarations = declarations;
  }
}

export class GeneratorError extends Error {}

export class Problems {
  readonly #lines: string[] = [];

  add(source: Source | null, message: string): void {
    if (source === null) this.#lines.push(message);
    else this.#lines.push(`${source.file}${source.line === null ? "" : `:${source.line}`}: ${message}`);
  }

  get isEmpty(): boolean {
    return this.#lines.length === 0;
  }

  get lines(): readonly string[] {
    return this.#lines;
  }

  throwIfAny(): void {
    if (!this.isEmpty) throw new GeneratorError(this.#lines.join("\n"));
  }
}
