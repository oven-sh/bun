import type { HostReadUse, Proof, RuntimeFunctionRole, Source } from "./declarations.ts";
import type {
  BoxedStubName,
  BuiltinKind,
  BuiltinMark,
  CallbackResultUse,
  CallbackTimes,
  CalleeKind,
  CallMode,
  Capability,
  ContentsSlot,
  Conversion,
  CppClassRef,
  DirectEntrySpec,
  DirectiveKind,
  ErrorKind,
  FeatureName,
  Freshness,
  Heap,
  HostReadContext,
  InlineBuiltinName,
  IntegrityLevel,
  IntrinsicPosition,
  IterationKind,
  KeyedProtocol,
  Mutability,
  NativeCallKind,
  OperandRole,
  OperandUse,
  Origin,
  ParameterMode,
  Primitive,
  PristineAspect,
  PristineTest,
  PromiseStatus,
  Protocol,
  RangeRule,
  Scope,
  SharingMode,
  TargetPlatform,
  TypedResultForm,
} from "./vocabulary.ts";

export const builtinFlags = [
  "ListsAllMembers",
  "IsGlobalObject",
  "IsLockedObject",
  "RequiresHolderAsThis",
  "IsDeterministic",
  "HasPrivateAlias",
  "IsOwnPropertyOfInstances",
  "IsLazilyCreated",
  "StartsInstance",
  "LoadsModuleByName",
  "EvaluatesText",
  "RunsUnseenCode",
  "IsCompilerHelper",
  "IsDefaultExport",
  "HasLockedMembers",
  "IsClosedToOtherNames",
] as const;
export type BuiltinFlag = (typeof builtinFlags)[number];

export const overloadFlags = [
  "IsUndeclared",
  "IsProvenByConstruction",
  "Throws",
  "RunsOnlyOperandCode",
  "ReadsStateBeforeConversions",
  "IsSpecialCase",
  "OnlyPropagatesErrors",
  "ResultIsDeclaredOnly",
] as const;
export type OverloadFlag = (typeof overloadFlags)[number];

export const instanceTests = ["None", "JSTypeEquals", "ClassInfoInherits", "SharingModeEquals"] as const;
export type InstanceTest = (typeof instanceTests)[number];

export const targetArchitectures = ["ARM64", "X86_64"] as const;
export type TargetArchitecture = (typeof targetArchitectures)[number];

export const propertyActionKinds = [
  "ReadsByKey",
  "StoresByKey",
  "DeletesByKey",
  "AssignsFrom",
  "DefinesName",
  "TakesDescriptor",
  "TakesDescriptorMap",
  "ChangesIntegrity",
  "ChangesPrototype",
  "BecomesPrototype",
  "DefinesGetter",
  "DefinesSetter",
  "ReadsGetter",
  "ReadsSetter",
  "TestsByKey",
  "DescribesOwnProperties",
  "DescribesResult",
  "DefinesFrom",
] as const;
export type PropertyActionKind = (typeof propertyActionKinds)[number];

export const typePartKinds = [
  "Instance",
  "InstanceOfReceiverClass",
  "TypedArrayOfReceiverElementType",
  "Layout",
  "Builtin",
  "Operand",
  "Slot",
  "IteratedValues",
  "CallbackResult",
  "Prototype",
] as const;
export type TypePartKind = (typeof typePartKinds)[number];

export const placeKinds = [
  "None",
  "Operand",
  "Slot",
  "IteratedValues",
  "OwnValues",
  "Result",
  "ResultSlot",
  "ResultField",
  "NewValue",
  "NativeMemory",
  "Prototype",
  "Member",
  "NativeCell",
] as const;
export type PlaceKind = (typeof placeKinds)[number];

export const keyKinds = ["None", "Any", "Indexes", "Names", "Operand", "ElementsOf"] as const;
export type KeyKind = (typeof keyKinds)[number];

export const implementationKinds = [
  "Generic",
  "HostCall",
  "Compiled",
  "Inline",
  "Number",
  "Cell",
  "CachedGetter",
  "OwnSlot",
] as const;
export type ImplementationKind = (typeof implementationKinds)[number];

export const prototypeLinks = ["Unknown", "Null", "Builtin"] as const;
export type PrototypeLink = (typeof prototypeLinks)[number];

export const hostReadUses = ["Inspected", "Called", "PassedTo", "Kept", "IsValueOf"] as const;
export type HostReadUseKind = (typeof hostReadUses)[number];

/** Of a function that native code makes and hands over by itself: the host answers it to nobody who asks. */
export const noHostNumber = 0xffff;

export const nameKinds = ["Text", "WellKnownSymbol", "RegisteredSymbol"] as const;
export type NameKind = (typeof nameKinds)[number];

export interface ModelName {
  number: number;
  text: string;
  kind: NameKind;
  cppConstant: string | null;
}

export type ModelOperand =
  { operand: "Receiver" } | { operand: "Argument"; index: number } | { operand: "ArgumentsFrom"; index: number };

export interface ModelBound {
  value: number;
  cppExpression: string | null;
}

export interface ModelSlotContents {
  slot: ModelSlot;
  type: ModelType;
}

export type ModelTypePart =
  | {
      part: "Instance";
      class: ModelClass;
      pristine: readonly PristineAspect[];
      isOfClassItself: boolean;
      contents: readonly ModelSlotContents[];
    }
  | { part: "InstanceOfReceiverClass" }
  | { part: "TypedArrayOfReceiverElementType" }
  | { part: "Layout"; layout: ModelLayout }
  | { part: "Builtin"; builtin: ModelBuiltin }
  | { part: "Operand"; operand: ModelOperand }
  | { part: "Slot"; operand: ModelOperand; slot: ModelSlot }
  | { part: "IteratedValues"; operand: ModelOperand; isSettled: boolean }
  | { part: "CallbackResult"; operand: ModelOperand }
  | { part: "Prototype"; operand: ModelOperand };

export interface ModelType {
  id: number;
  key: string;
  isAnything: boolean;
  hasAnyObject: boolean;
  hasAnyFunction: boolean;
  hasPlainData: boolean;
  primitives: readonly Primitive[];
  integers: { minimum: ModelBound; maximum: ModelBound } | null;
  stringLiterals: readonly ModelName[];
  freshness: Freshness;
  parts: readonly ModelTypePart[];
}

export type ModelPlace =
  | { place: "None" }
  | { place: "Operand"; operand: ModelOperand }
  | { place: "Slot"; operand: ModelOperand; slot: ModelSlot }
  | { place: "IteratedValues"; operand: ModelOperand; isSettled: boolean }
  | { place: "OwnValues"; operand: ModelOperand }
  | { place: "Result" }
  | { place: "ResultSlot"; slot: ModelSlot }
  | { place: "ResultField"; index: number; holdsOnlyWhatIsStored: boolean }
  | { place: "NewValue"; type: ModelType }
  | { place: "NativeMemory" }
  | { place: "Prototype"; operand: ModelOperand }
  | { place: "Member"; operand: ModelOperand; path: readonly (ModelName | null)[]; firstStep: number }
  | { place: "NativeCell"; cell: ModelName };

export type ModelKey =
  | { key: "None" }
  | { key: "Operand"; operand: ModelOperand }
  | { key: "ElementsOf"; operand: ModelOperand }
  | { key: "Names"; names: readonly ModelName[] }
  | { key: "Indexes" }
  | { key: "Any" };

export interface ModelTransfer {
  from: ModelPlace;
  to: ModelPlace;
}

export interface ModelCallback {
  callee: ModelOperand;
  times: CallbackTimes;
  constructs: boolean;
  newTarget: ModelPlace;
  thisValue: ModelPlace;
  arguments: readonly ModelPlace[];
  spreadArguments: ModelPlace;
  resultUse: CallbackResultUse;
  resultTo: ModelPlace;
}

export interface ModelHandlerCall {
  callee: ModelPlace;
  times: CallbackTimes;
  thisValue: ModelPlace;
  arguments: readonly ModelPlace[];
  resultUse: CallbackResultUse;
}

export interface ModelPropertyAction {
  action: PropertyActionKind;
  object: ModelOperand;
  key: ModelKey;
  value: ModelPlace;
  integrityLevel: IntegrityLevel | null;
}

export interface ModelParameter {
  name: string;
  operand: ModelOperand;
  mode: ParameterMode;
  accepted: ModelType;
  conversion: Conversion;
  converted: ModelType;
  refused: ModelType;
  admitted: ModelType | null;
  uses: readonly OperandUse[];
  roles: readonly OperandRole[];
  protocols: readonly Protocol[];
  namedMembers: readonly ModelName[];
  calledMembers: readonly ModelName[];
  convertedMembers: readonly ModelName[];
}

export interface ModelResultLayout {
  layout: ModelLayout;
  isOrdinaryObject: boolean;
}

export interface ModelPlatformType {
  platform: TargetPlatform;
  type: ModelType;
}

export interface ModelResult {
  type: ModelType;
  /** Empty where the platform decides nothing. Else one for each platform, and `type` is all of them together. */
  typesByPlatform: readonly ModelPlatformType[];
  layouts: readonly ModelResultLayout[];
  rangeRule: RangeRule;
  rangeOperand: ModelOperand | null;
  substringOf: ModelOperand | null;
  typedResultForm: TypedResultForm;
  typedResultSource: ModelOperand | null;
  iteratedOperand: ModelOperand | null;
  iterationKind: IterationKind | null;
  prototypeSource: ModelOperand | null;
  properties: readonly ModelResultProperty[];
}

export interface ModelEffects {
  capability: Capability;
  reads: readonly Heap[];
  writes: readonly Heap[];
}

export interface ModelFlow {
  transfers: readonly ModelTransfer[];
  callbacks: readonly ModelCallback[];
  propertyActions: readonly ModelPropertyAction[];
  handlerCalls: readonly ModelHandlerCall[];
}

/** The Structure that a getter of JSGlobalObject answers, after the transitions that add the names in their order. */
export interface ModelRealmStructure {
  id: number;
  getter: string;
  names: readonly ModelName[];
}

export type ModelImplementation =
  | { how: "Generic" }
  | { how: "HostCall"; callee: CalleeKind; function: ModelFunction | null; customGetter: string | null }
  | { how: "Compiled"; callee: CalleeKind; function: ModelFunction }
  | {
      how: "Inline";
      builtin: InlineBuiltinName;
      parameters: readonly string[];
      maximumArgumentCount: number | null;
      otherwise: Extract<ModelImplementation, { how: "Generic" | "HostCall" | "Compiled" }> | null;
    }
  | { how: "Number" }
  | { how: "Cell" }
  | { how: "CachedGetter"; cppClass: string; member: string }
  | { how: "OwnSlot"; structure: ModelRealmStructure; offset: number };

export interface ModelResultProperty {
  name: ModelName;
  type: ModelType;
}

export interface ModelCode {
  implementation: ModelImplementation;
  directEntry: DirectEntrySpec | null;
  model: ModelFunction | null;
  fieldsForm: InlineBuiltinName | null;
  prefixForm: InlineBuiltinName | null;
  prefixProperties: readonly ModelResultProperty[];
  listForm: InlineBuiltinName | null;
}

export interface ModelOverload {
  id: number;
  indexInBuiltin: number;
  builtin: ModelBuiltin;
  mode: CallMode;
  source: Source;
  proof: Proof;
  flags: readonly OverloadFlag[];
  receiver: ModelParameter | null;
  parameters: readonly ModelParameter[];
  result: ModelResult;
  effects: ModelEffects;
  flow: ModelFlow;
  code: ModelCode;
  textHash: string;
}

export type ModelDispatchTarget = { node: ModelDispatchNode } | { overload: ModelOverload };

export interface ModelDispatchBranch {
  tested: ModelType;
  target: ModelDispatchTarget;
}

export interface ModelDispatchNode {
  id: number;
  operand: ModelOperand;
  branches: readonly ModelDispatchBranch[];
}

export interface ModelDispatch {
  builtin: ModelBuiltin;
  mode: CallMode;
  root: ModelDispatchTarget;
}

export interface ModelCondition {
  operand: ModelOperand | null;
  isOneOf: readonly ModelName[];
  startsWith: readonly ModelName[];
  calledOn: ModelBuiltin | null;
  hasProperty: ModelName | null;
  buildAdmitsRuntimeCode: boolean;
  callRunsOtherCode: boolean;
  objectNobodyKnowsIsWritten: boolean;
}

export interface ModelFeatureUse {
  feature: FeatureName;
  overload: ModelOverload | null;
  isGuard: boolean;
  condition: ModelCondition | null;
}

export type ModelHostValue = Extract<ModelPlace, { place: "None" | "NewValue" | "NativeCell" | "NativeMemory" }>;

export interface ModelHostCall {
  times: CallbackTimes;
  thisValue: ModelHostValue;
  /** null: what the annotations of the callee's own parameters say. */
  arguments: readonly ModelHostValue[] | null;
  otherArguments: ModelHostValue;
  result: ModelHostUses;
}

/** The names lead from the value to what native code uses. */
export type ModelHostUse = { path: readonly ModelName[] } & (
  | { read: "Inspected" }
  | { read: "Called"; call: ModelHostCall | null }
  | { read: "PassedTo"; builtin: ModelBuiltin; argument: number }
  | { read: "Kept"; cell: ModelName }
  | { read: "IsValueOf"; builtin: ModelBuiltin }
);

/** null: nothing says what native code does with the value, so anybody may get it. */
export type ModelHostUses = readonly ModelHostUse[] | null;

export interface ModelExportRead {
  name: ModelName;
  uses: ModelHostUses;
}

export interface ModelModuleLoad {
  module: ModelModule;
  exports: readonly ModelExportRead[] | null;
  condition: ModelCondition | null;
}

export interface ModelCalledFunction {
  function: ModelFunction;
  condition: ModelCondition | null;
  /** What native code does with the object of the function. */
  uses: ModelHostUses;
}

export interface ModelHostObjectField {
  /** null: every other name and index. */
  name: ModelName | null;
  value: ModelHostValue;
}

export interface ModelHostObjectInternalField {
  index: number;
  uses: readonly ModelHostUse[];
}

export interface ModelHostObject {
  cell: ModelName;
  function: ModelBuiltin | null;
  prototype: ModelBuiltin | null;
  fields: readonly ModelHostObjectField[];
  internalFields: readonly ModelHostObjectInternalField[];
  keepsStringsOfStoredValues: boolean;
  source: Source;
}

export interface ModelHostMethodCall {
  name: ModelName;
  cell: ModelName;
  call: ModelHostCall;
  source: Source;
}

export interface ModelNamedMemberCall {
  name: ModelName;
  arguments: readonly ModelHostValue[];
  source: Source;
}

export interface ModelNativeFunction {
  symbol: string;
  length: number;
  header: string | null;
}

export interface ModelAttachments {
  featureUses: readonly ModelFeatureUse[];
  unseenCodeCondition: ModelCondition | null;
  moduleLoads: readonly ModelModuleLoad[];
  calledFunctions: readonly ModelCalledFunction[];
  appendForm: InlineBuiltinName | null;
  hostAppendSymbol: string | null;
  jsonTextForm: { argument: ModelOperand; builtin: ModelBuiltin } | null;
  literalPartsForm: { argument: ModelOperand; names: readonly ModelName[]; builtin: ModelBuiltin } | null;
  bodyBytesForm: ModelBuiltin | null;
  boxedCallStub: BoxedStubName | null;
  nativeFunction: ModelNativeFunction | null;
  nativeSymbols: readonly string[];
  creationSymbol: string | null;
  linkTimeConstant: string | null;
}

export type ModelPrototype = { link: "Unknown" } | { link: "Null" } | { link: "Builtin"; builtin: ModelBuiltin };

/** What an entry holds in an executable for one of the listed platforms and one of the listed architectures. */
export interface ModelTargetText {
  platforms: readonly TargetPlatform[];
  architectures: readonly TargetArchitecture[];
  text: ModelName;
}

export type ModelConstant =
  | { constant: "Number"; value: number; cppExpression: string | null }
  | { constant: "String"; texts: readonly ModelTargetText[] }
  | { constant: "Symbol"; name: ModelName }
  | { constant: "Undefined" };

export interface ModelBuiltin {
  id: number;
  token: string;
  path: readonly string[];
  text: string;
  kind: BuiltinKind;
  origin: Origin;
  scope: Scope;
  mutability: Mutability;
  platforms: readonly TargetPlatform[];
  flags: readonly BuiltinFlag[];
  marks: readonly BuiltinMark[];
  loadsMachineCodeAs: ModelBuiltin | null;
  holder: ModelBuiltin | null;
  name: ModelName;
  prototype: ModelPrototype;
  instanceClass: ModelClass | null;
  sameObjectAs: ModelBuiltin | null;
  members: readonly ModelBuiltin[];
  overloads: readonly ModelOverload[];
  constant: ModelConstant | null;
  /** Of a native binding that some text of the library names: what the host evaluates it by. It depends on how Bun is built, so the engine's half of the table does not hold it. */
  hostNumber: number;
  attachments: ModelAttachments;
}

export interface ModelSlot {
  id: number;
  owner: ModelClass;
  name: ModelName;
  indexInClass: number;
  heap: Heap;
  contentsSlot: ContentsSlot | null;
  indexInType: number | null;
  holds: ModelType | null;
}

export interface ModelTypeName {
  path: readonly string[];
  isView: boolean;
  typeArguments: readonly ModelSlot[];
}

export interface ModelClass {
  id: number;
  token: string;
  origin: Origin;
  parent: ModelClass | null;
  constructor: ModelBuiltin | null;
  prototype: ModelBuiltin | null;
  jsType: string;
  typedArrayType: string;
  instanceTest: InstanceTest;
  sharingMode: SharingMode | null;
  instanceCppClass: CppClassRef | null;
  prototypeCppExpression: string | null;
  instanceStructureCppExpression: string | null;
  isPrimitiveWrapper: boolean;
  isNeverPristine: boolean;
  pristineTest: PristineTest;
  hasClosureInstances: boolean;
  instancesAreEntries: boolean;
  definesCharactersOnNewInstances: boolean;
  namesDefinedOnNewInstances: readonly ModelName[] | null;
  typesOfNamesDefinedOnNewInstances: readonly ModelResultProperty[];
  namesMadeByStaticMembers: readonly { name: ModelName; member: ModelName }[];
  constructorOnlyReadsPrototypeOfNewTarget: boolean;
  slots: readonly ModelSlot[];
  stateHeap: Heap | null;
  types: readonly ModelTypeName[];
}

export interface ModelLayoutField {
  name: ModelName | null;
  isOptional: boolean;
  type: ModelType;
}

export interface ModelLayout {
  id: number;
  token: string;
  origin: Origin;
  isTuple: boolean;
  fields: readonly ModelLayoutField[];
}

export interface ModelModule {
  id: number;
  token: string;
  specifier: string;
  hasSource: boolean;
  /** The registry does not have it: the loader takes its source as an ES module, with an export table and a namespace object. */
  isEsModule: boolean;
  hasOpenNamespace: boolean;
  listsAllExports: boolean;
  isPublic: boolean;
  namespace: ModelBuiltin;
  exportsHeldByNamespace: readonly ModelName[];
}

export type ModelFunctionRole = RuntimeFunctionRole | "Model";

export interface ModelFunction {
  id: number;
  role: ModelFunctionRole;
  file: string;
  name: string;
  exportName: string;
  cppCodeName: string | null;
  isHiddenInStackTraces: boolean;
  isNeverInlined: boolean;
  usesStubConvention: boolean;
  platforms: readonly TargetPlatform[];
  implements: readonly ModelBuiltin[];
}

export type ModelIntrinsicMeaning =
  | { intrinsic: "Operation"; opcode: string }
  | { intrinsic: "Conversion"; conversion: Exclude<Conversion, "None" | "Dictionary"> }
  | { intrinsic: "Throw"; error: ErrorKind }
  | { intrinsic: "IfAbruptCloseIterator" }
  | { intrinsic: "SymbolKey"; symbol: ModelName }
  | { intrinsic: "HasJSType"; first: string; last: string }
  | { intrinsic: "Builtin" | "Construct" | "NativeBinding"; builtin: ModelBuiltin }
  | { intrinsic: "LinkTimeConstant"; constant: string }
  | { intrinsic: "Int"; value: number }
  | { intrinsic: "Bool"; value: boolean }
  | { intrinsic: "Double"; value: number }
  | { intrinsic: "Call"; isNeverInlined: boolean }
  | { intrinsic: "PutByValDirect" | "GetOwnProperty"; privateKey: boolean }
  | { intrinsic: "Directive"; directive: DirectiveKind }
  | { intrinsic: "PrependArgument"; callee: ModelName; argument: number }
  | { intrinsic: "HasPromiseStatus"; status: PromiseStatus }
  | { intrinsic: "NativeCall"; kind: NativeCallKind }
  | { intrinsic: "LinkedFunction"; function: ModelFunction }
  | {
      intrinsic:
        | "IsNullish"
        | "IsObject"
        | "IsCallable"
        | "Undefined"
        | "Apply"
        | "ArrayPush"
        | "ArgumentCount"
        | "Argument"
        | "PrivateGlobal"
        | "ReplaceablePrivateGlobal"
        | "PrivateName"
        | "Erased"
        | "BundleError";
    };

export interface ModelIntrinsic {
  name: ModelName;
  position: IntrinsicPosition;
  meaning: ModelIntrinsicMeaning;
}

export interface ModelPrefixedGlobal {
  name: ModelName;
  meaning: ModelIntrinsicMeaning;
}

export interface ModelNativeBinding {
  kind: NativeCallKind;
  file: ModelName;
  symbol: ModelName;
  builtin: ModelBuiltin | null;
}

export interface ModelHostRead {
  context: HostReadContext;
  exportName: ModelName;
  use: Exclude<HostReadUse, { read: "PassedTo" }> | { read: "PassedTo"; builtin: ModelBuiltin; argument: number };
}

export interface ModelProtocolKeys {
  protocol: KeyedProtocol;
  keys: readonly ModelName[];
}

export interface ModelClosedKeys {
  holder: ModelBuiltin;
  keys: readonly ModelName[];
  openNames: readonly ModelName[];
}

export interface ModelNamesReadByNativeCode {
  holder: ModelBuiltin;
  names: readonly ModelName[];
  namesOnlyInspected: readonly ModelName[];
}

export interface ModelStartup {
  modules: readonly ModelModule[];
  loads: readonly ModelModuleLoad[];
  functionsCalledWithLoads: readonly ModelCalledFunction[];
  namesOfMethodsCallingLoads: readonly ModelName[];
  moduleLoaderFunctions: readonly ModelFunction[];
}

export interface ModelSyntax {
  intrinsics: readonly ModelIntrinsic[];
  prefixedGlobals: readonly ModelPrefixedGlobal[];
  nativeBindings: readonly ModelNativeBinding[];
  checkedJSTypes: readonly string[];
  linkTimeConstants: readonly string[];
}

export interface ModelEngineFile {
  name: string;
  text: string;
}

/** What the table takes from the list of what an executable can be linked without. */
export interface TableFeature {
  name: FeatureName;
  index: number;
  isEngine: boolean;
}

export interface TableModel {
  names: readonly ModelName[];
  builtins: readonly ModelBuiltin[];
  membersLockedByName: readonly ModelBuiltin[];
  closedKeys: readonly ModelClosedKeys[];
  namesReadByNativeCode: readonly ModelNamesReadByNativeCode[];
  overloads: readonly ModelOverload[];
  dispatches: readonly ModelDispatch[];
  dispatchNodes: readonly ModelDispatchNode[];
  types: readonly ModelType[];
  classes: readonly ModelClass[];
  slots: readonly ModelSlot[];
  layouts: readonly ModelLayout[];
  realmStructures: readonly ModelRealmStructure[];
  modules: readonly ModelModule[];
  functions: readonly ModelFunction[];
  features: readonly FeatureName[];
  boxedStubs: readonly BoxedStubName[];
  protocolKeys: readonly ModelProtocolKeys[];
  hostReads: readonly ModelHostRead[];
  /** What hand-written code of the engine may name besides the entries, classes and layouts that the engine declares. */
  namesOfEngine: ReadonlySet<ModelName>;
  /** The token is the role's. The entry is another where the host leaves the role out. */
  hostRoles: readonly { token: string; builtin: ModelBuiltin }[];
  hostClassRoles: readonly { token: string; builtinClass: ModelClass }[];
  hostObjects: readonly ModelHostObject[];
  namedMemberCalls: readonly ModelNamedMemberCall[];
  hostMethodCalls: readonly ModelHostMethodCall[];
  checkedNumbers: readonly ModelBound[];
  startup: ModelStartup;
  syntax: ModelSyntax;
  engineFiles: readonly ModelEngineFile[];
}
