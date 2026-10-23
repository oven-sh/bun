/** The word of a schema of Bun's natives (src/codegen/bindgen-lib-internal.ts) means the same. */
export type Capability = "none" | "heap" | "js";

export const capabilities = ["js", "heap", "none"] as const satisfies readonly Capability[];

export const targetPlatforms = ["Darwin", "Linux", "Windows", "FreeBSD", "Android"] as const;
export type TargetPlatform = (typeof targetPlatforms)[number];

export const builtinKinds = [
  "Namespace",
  "Constructor",
  "Function",
  "Prototype",
  "Method",
  "Accessor",
  "DataProperty",
  "Constant",
  "NativeBinding",
] as const;
export type BuiltinKind = (typeof builtinKinds)[number];

export const callModes = ["Call", "Construct", "Get", "Set"] as const;
export type CallMode = (typeof callModes)[number];

export const origins = ["Engine", "Host"] as const;
export type Origin = (typeof origins)[number];

export const scopes = ["Realm", "Module"] as const;
export type Scope = (typeof scopes)[number];

/** What may become of the location that an entry stands for, the property of its holder under its name. */
export const mutabilities = ["ChangesOnItsOwn", "ConstantUnlessWritten", "AlwaysLocked"] as const;
export type Mutability = (typeof mutabilities)[number];

export const primitives = [
  "Undefined",
  "Null",
  "Boolean",
  "Number",
  "String",
  "Symbol",
  "BigInt",
  "NotPassed",
] as const;
export type Primitive = (typeof primitives)[number];

export const conversions = [
  "None",
  "ToBoolean",
  "ToNumber",
  "ToNumeric",
  "ToString",
  "ToPropertyKey",
  "ToObject",
  "ToPrimitive",
  "ToIntegerOrInfinity",
  "ToLength",
  "ToIndex",
  "ToInt32",
  "ToUint32",
  "ToBigInt",
  "Dictionary",
] as const;
export type Conversion = (typeof conversions)[number];

export const protocols = [
  "OwnKeys",
  "OwnValues",
  "ToPrimitive",
  "Thenable",
  "Iterate",
  "Species",
  "ToJSON",
  "HasInstance",
  "PrototypeChain",
  "Named",
  "CallsNamed",
] as const;
export type Protocol = (typeof protocols)[number];
export type KeyedProtocol = Exclude<Protocol, "Named" | "CallsNamed">;

export const protocolKeys: Readonly<Record<KeyedProtocol, readonly string[]>> = {
  OwnKeys: [],
  OwnValues: [],
  ToPrimitive: ["@@toPrimitive", "valueOf", "toString"],
  Thenable: ["then"],
  Iterate: ["@@iterator", "@@asyncIterator", "next", "return"],
  Species: ["constructor", "@@species"],
  ToJSON: ["toJSON"],
  HasInstance: ["@@hasInstance", "prototype"],
  PrototypeChain: [],
};

export const protocolsProbedOnAnyObject = ["Thenable", "ToJSON"] as const satisfies readonly Protocol[];
export const namesProbedOnIterators: readonly string[] = ["next", "return", "throw"];
export const textsOfPrimitiveKeys: readonly string[] = ["undefined", "null", "true", "false"];
export const iteratorRootClasses: readonly ClassName[] = ["Iterator", "AsyncIterator"];

export const conversionProtocols: Readonly<Record<Conversion, readonly Protocol[]>> = {
  None: [],
  ToBoolean: [],
  ToNumber: ["ToPrimitive"],
  ToNumeric: ["ToPrimitive"],
  ToString: ["ToPrimitive"],
  ToPropertyKey: ["ToPrimitive"],
  ToObject: [],
  ToPrimitive: ["ToPrimitive"],
  ToIntegerOrInfinity: ["ToPrimitive"],
  ToLength: ["ToPrimitive"],
  ToIndex: ["ToPrimitive"],
  ToInt32: ["ToPrimitive"],
  ToUint32: ["ToPrimitive"],
  ToBigInt: ["ToPrimitive"],
  Dictionary: ["Named"],
};

// A value inside the accepted type fails these by what it is: a negative index, a text that is no BigInt.
export const conversionsFailingByValue: readonly Conversion[] = ["ToIndex", "ToBigInt", "Dictionary"];

export const operandUses = [
  "Inspects",
  "Retains",
  "Returns",
  "Calls",
  "CallsPerElement",
  "CallsRepeatedly",
  "ReadsContents",
  "WritesContents",
  "RetainsContents",
  "MovesElements",
  "StoresByKey",
  "DeletesByKey",
  "AssignsFrom",
  "DefinesName",
  "TakesDescriptor",
  "ChangesIntegrity",
  "ChangesPrototype",
  "BecomesPrototype",
  "PassesToUserCode",
  "AppliesTransitively",
  "AppliesToContents",
] as const;
export type OperandUse = (typeof operandUses)[number];

export const operandRoles = [
  "EvaluatedAsText",
  "ModuleSpecifier",
  "ReadAsCharacters",
  "Locale",
  "ContentKey",
  "ReplacesContents",
  "MembersAreOnlyInspected",
  "KeysAreNotListed",
  "MembersAreOfObjectsOnly",
  "FunctionsAreConvertedUnderNamesOnly",
  "BecomesLengthOfReceiver",
  "CopiesHolesToResult",
] as const;
export type OperandRole = (typeof operandRoles)[number];

export const pristineAspects = ["Storage", "Names", "AsCreated", "Dense", "NamesKeptBelow"] as const;
export type PristineAspect = (typeof pristineAspects)[number];

export const contentsSlots = ["Element", "Key", "Value"] as const;
export type ContentsSlot = (typeof contentsSlots)[number];

export const freshnesses = ["No", "Unaliased", "UnlessSpecies", "Yes"] as const;
export type Freshness = (typeof freshnesses)[number];

export const callbackTimes = ["Later", "Repeatedly", "PerElement", "Once", "PerEvent"] as const;
export type CallbackTimes = (typeof callbackTimes)[number];

export const callbackResultUses = ["Escapes", "Ignored", "Tested", "Returned", "Stored"] as const;
export type CallbackResultUse = (typeof callbackResultUses)[number];

export const rangeRules = [
  "None",
  "MinimumOfArguments",
  "MaximumOfArguments",
  "AbsoluteValue",
  "IntegerPart",
  "Sign",
] as const;
export type RangeRule = (typeof rangeRules)[number];

export const typedResultForms = ["None", "ParsedText", "ParsedBody", "Rows", "ValidatedValue"] as const;
export type TypedResultForm = (typeof typedResultForms)[number];

export const iterationKinds = ["Keys", "Values", "Entries"] as const;
export type IterationKind = (typeof iterationKinds)[number];

export const typedArrayTypes = [
  "NotTypedArray",
  "TypeInt8",
  "TypeUint8",
  "TypeUint8Clamped",
  "TypeInt16",
  "TypeUint16",
  "TypeInt32",
  "TypeUint32",
  "TypeFloat16",
  "TypeFloat32",
  "TypeFloat64",
  "TypeBigInt64",
  "TypeBigUint64",
  "TypeDataView",
] as const;

export const sharingModes = ["Default", "Shared"] as const;
export type SharingMode = (typeof sharingModes)[number];

export const integrityLevels = ["NonExtensible", "Sealed", "Frozen"] as const;
export type IntegrityLevel = (typeof integrityLevels)[number];

export const parameterModes = ["Required", "Optional", "Rest"] as const;
export type ParameterMode = (typeof parameterModes)[number];

export const calleeKinds = ["None", "Function", "HostFunction", "InternalFunction", "CustomGetter"] as const;
export type CalleeKind = (typeof calleeKinds)[number];

export const hostReadContexts = ["EntryPoint", "Worker", "Preload", "Plugin", "TestFile"] as const;
export type HostReadContext = (typeof hostReadContexts)[number];

export type Heap = string;
export type FeatureName = string;
export type InlineBuiltinName = string;

export const effectsOfHeapCapability = ["Allocates", "UsesRuntime", "ResolvesRopes"] as const;
export type BoxedStubName = string;
export type BuiltinPath = string;
export type ClassName = string;
export type LayoutName = string;
export type SlotName = string;
export type OperandName = "this" | (string & {});

export interface CheckedNumber {
  value: number;
  cppExpression: string;
}
export type Bound = number | CheckedNumber;

export type TypeSpec =
  | { type: "Anything"; freshness?: Freshness }
  | { type: "Never" }
  | { type: "Primitive"; primitive: Primitive; freshness?: Freshness }
  | { type: "Integers"; minimum: Bound; maximum: Bound }
  | { type: "StringLiterals"; values: readonly string[] }
  | { type: "Object"; freshness?: Freshness }
  | { type: "Function" }
  | { type: "PlainData" }
  | {
      type: "Instance";
      class: ClassName;
      contents?: Readonly<Record<SlotName, TypeSpec>>;
      pristine?: readonly PristineAspect[];
      // Of the class itself. Without it the value may be of any class below the one that is named.
      isOfClassItself?: boolean;
      freshness?: Freshness;
    }
  | { type: "InstanceOfReceiverClass"; freshness?: Freshness }
  | { type: "TypedArrayOfReceiverElementType"; freshness?: Freshness }
  | { type: "Layout"; layout: LayoutName; isOrdinaryObject?: boolean; freshness?: Freshness }
  | { type: "Builtin"; path: BuiltinPath }
  | { type: "Operand"; operand: OperandName }
  | { type: "Slot"; operand: OperandName; slot: SlotName }
  | { type: "IteratedValues"; operand: OperandName; isSettled?: boolean }
  | { type: "Prototype"; operand: OperandName }
  | { type: "CallbackResult"; operand: OperandName }
  | { type: "Union"; members: readonly TypeSpec[] };

export interface ParameterType {
  accepted: TypeSpec;
  conversion: Conversion;
  converted: TypeSpec;
  refused: TypeSpec;
  admitted?: TypeSpec;
  mode: ParameterMode;
  members: readonly string[];
}

export type PlaceSpec =
  | { place: "Operand"; operand: OperandName }
  | { place: "Slot"; operand: OperandName; slot: SlotName }
  | { place: "IteratedValues"; operand: OperandName; isSettled?: boolean }
  | { place: "OwnValues"; operand: OperandName }
  | { place: "Result" }
  | { place: "ResultSlot"; slot: SlotName }
  | { place: "ResultField"; field: string | number; holdsOnlyWhatIsStored?: boolean }
  | { place: "NewValue"; value: TypeSpec }
  | { place: "NativeMemory" }
  | { place: "Prototype"; operand: OperandName }
  | { place: "Member"; operand: OperandName; path: MemberPath }
  | { place: "NativeCell"; cell: string };

// The names that are read one after the other, starting at an operand. null stands for every own value.
export type MemberPath = readonly (string | null)[];

export type KeySpec =
  | { key: "Operand"; operand: OperandName }
  | { key: "ElementsOf"; operand: OperandName }
  | { key: "Names"; names: readonly string[] }
  | { key: "Indexes" }
  | { key: "Any" };

export interface CallbackSpec {
  times: CallbackTimes;
  constructs?: boolean;
  newTarget?: PlaceSpec;
  thisValue?: PlaceSpec;
  arguments?: readonly PlaceSpec[];
  spreadArguments?: PlaceSpec;
  result?: CallbackResultUse;
  resultTo?: PlaceSpec;
}

export interface HandlerSpec {
  times: CallbackTimes;
  thisValue?: PlaceSpec;
  arguments?: readonly PlaceSpec[];
  result?: CallbackResultUse;
}

export type ProtocolSpec = KeyedProtocol | { named: readonly string[] } | { calls: readonly string[] };

export type UseSpec =
  | { use: "Retains"; in: PlaceSpec }
  | { use: "Returns" }
  | ({ use: "Calls" } & CallbackSpec)
  | ({ use: "CallsMember"; path: MemberPath } & HandlerSpec)
  | ({ use: "CallsKept"; cell: string } & HandlerSpec)
  | { use: "RetainsMember"; path: MemberPath; in: PlaceSpec }
  | { use: "ReturnsKept"; cell: string }
  | { use: "Creates"; value: TypeSpec; in: PlaceSpec }
  | { use: "ReadsByKey"; key: KeySpec; to: PlaceSpec }
  | { use: "StoresByKey"; key: KeySpec; value: PlaceSpec }
  | { use: "DeletesByKey"; key: KeySpec }
  | { use: "TestsByKey"; key: KeySpec }
  | { use: "AssignsFrom"; sources: OperandName }
  | { use: "DefinesFrom"; source: OperandName }
  | { use: "DefinesName"; key: KeySpec; value: PlaceSpec }
  | { use: "DefinesGetter" | "DefinesSetter"; key: KeySpec; value: PlaceSpec }
  | { use: "ReadsGetter" | "ReadsSetter"; key: KeySpec; to: PlaceSpec }
  | { use: "TakesDescriptor"; key: KeySpec; descriptor: OperandName }
  | { use: "TakesDescriptorMap"; descriptors: OperandName }
  | { use: "DescribesOwnProperties" }
  | { use: "DescribesResult" }
  | { use: "MovesElements" }
  | { use: "ReadsContents"; slot?: SlotName }
  | { use: "WritesContents"; slot?: SlotName }
  | { use: "RetainsContents"; in: PlaceSpec; transitively?: boolean }
  | { use: "RetainsSettledValues"; in: PlaceSpec }
  | { use: "RetainsIteratedValues"; in: PlaceSpec }
  | { use: "ChangesIntegrity"; level: IntegrityLevel }
  | { use: "ChangesPrototype"; to: OperandName }
  | { use: "BecomesPrototype"; of: PlaceSpec }
  | { use: "Role"; role: OperandRole }
  | { use: "Runs"; protocols: readonly ProtocolSpec[]; on?: "ReachableObjects" | "Contents" }
  | { use: "Everything" };

export interface FunctionRef {
  file: string;
  name: string;
}

export type ImplementationSpec =
  | { how: "Generic" }
  | { how: "HostCall"; customGetter?: string }
  | { how: "Compiled"; function: FunctionRef; usesStubConvention?: boolean }
  | {
      how: "Inline";
      builtin: InlineBuiltinName;
      parameters: readonly (string | number)[];
      maximumArgumentCount?: number;
      otherwise: Extract<ImplementationSpec, { how: "HostCall" | "Compiled" }> | { how: "Nothing" };
    }
  | { how: "CachedGetter"; cppClass: string; member: string }
  | { how: "OwnSlot"; structure: string; after: readonly string[] };

// What a C function of the host takes as one parameter in a call that compiled code makes without the function object, and the C++ types that the parameter can have.
const typesOfValue = ["JSC::EncodedJSValue", "JSC::JSCell*", "JSC::JSObject*", "JSC::JSString*"] as const;
export const directValueTypes = {
  Realm: ["JSC::JSGlobalObject*"],
  NativeObjectOfReceiver: ["void*"],
  Receiver: ["JSC::EncodedJSValue", "JSC::JSCell*"],
  Value: typesOfValue,
  ValueOrEmpty: typesOfValue,
  RestOfValues: ["const JSC::EncodedJSValue*, size_t", "Bun::Bindgen::ExternVariadicArguments"],
  FrameOfValues: ["JSC::CallFrame*"],
  Boolean: ["bool"],
  Int32: ["int32_t"],
  Double: ["double"],
} as const satisfies Record<string, readonly string[]>;
export type DirectValue = keyof typeof directValueTypes;
export const maximumDirectParameterCount = 6;
export const realmParameter: DirectParameterSpec = { value: "Realm", cppType: "JSC::JSGlobalObject*" };

export interface DirectParameterSpec {
  value: DirectValue;
  cppType: string;
}

/** How an operand is handed over, and what the caller has proven it to be. */
export interface DirectForm extends DirectParameterSpec {
  type: TypeSpec;
}

/** A C function that takes the operands untested. It answers a value, or nothing with an exception. */
export interface DirectEntrySpec {
  symbol: string;
  /** As it stands beside the definition of the function. */
  declaration: string;
  /** They declare what the declaration is spelled with. */
  headers: readonly string[];
  parameters: readonly DirectParameterSpec[];
  /** A C++ expression: where in the cell of the receiver the pointer to what it wraps lies. */
  offsetOfNativeObject?: string;
}

export interface NativeCodeRef {
  /** As C++ names the function where Bun's, JavaScriptCore's and WebCore's names are in scope. */
  symbol: string;
  /** Declares it. Without one, a name with a namespace is declared in that namespace and any other is a C function. */
  header?: string;
}

export type ConditionSpec =
  /** calledOn: and the receivers of the call list the object of that entry. A receiver nobody knows is not taken for it: should it be the entry at run time, what hangs on the row was not compiled and throws the error that names it. */
  | { operand: OperandName; isOneOf: readonly string[]; startsWith: readonly string[]; calledOn?: BuiltinPath }
  | { operand: OperandName; hasProperty: string }
  | { buildAdmitsRuntimeCode: true }
  | { callRunsOtherCode: true }
  | { objectNobodyKnowsIsWritten: true };

export type FeatureUseSpec = FeatureName | { feature: FeatureName; when: ConditionSpec };

/** What native code has at hand where no call of a built-in is under way: a value that it makes, what lies in a native cell, or something that nobody describes. */
export type HostValueSpec = Extract<PlaceSpec, { place: "NewValue" | "NativeCell" | "NativeMemory" }>;

export interface HostCallSpec {
  times: CallbackTimes;
  thisValue?: HostValueSpec;
  /** Without a list native code passes what the annotations of the callee's own parameters say. */
  arguments?: readonly HostValueSpec[];
  /** What may follow the listed arguments, any number of times. */
  otherArguments?: HostValueSpec;
  /** Without a list anybody may get what the call answers. An empty list: native code drops it. */
  result?: readonly HostUseSpec[];
}

/** One thing that native code does with a value that it got hold of by itself: an export that it read from a module, the object of a function of the library, what a call of its own answered. */
export type HostUseSpec =
  | { read: "Inspected" }
  | { read: "Called"; call?: HostCallSpec }
  | { read: "PassedTo"; builtin: BuiltinPath; argument: number }
  | { read: "Kept"; cell: string }
  | { read: "IsValueOf"; builtin: BuiltinPath }
  | { read: "Member"; name: string | number; uses: readonly HostUseSpec[] };

export interface ExportReadSpec {
  name: string;
  uses: readonly HostUseSpec[];
}

export interface ModuleLoadSpec {
  module: string;
  /** A bare name: nothing says what native code does with the export, so anybody may get it. */
  exports?: readonly (string | ExportReadSpec)[];
  when?: ConditionSpec;
}

/** Without uses native code calls the function with what the annotations of its parameters say, and anybody may get what it answers. */
export type CalledFunctionSpec =
  FunctionRef | { function: FunctionRef; when?: ConditionSpec; uses?: readonly HostUseSpec[] };

export interface HostObjectFieldSpec {
  /** null: every other name and index. */
  name: string | null;
  values: readonly HostValueSpec[];
}

export interface HostObjectInternalFieldSpec {
  index: number;
  /** What native code does with what code of the library stores there. */
  uses: readonly HostUseSpec[];
}

export type CallingEntrySpec = BuiltinPath | { path: BuiltinPath; when: ConditionSpec };

export interface NativeMentionSpec {
  file: string;
  times?: number;
}

export interface NativeCallerSpec extends NativeMentionSpec {
  caller: string;
  onBehalfOf: readonly CallingEntrySpec[];
  /** What this caller does with the functions, where more is known of it than of the callers beside it. */
  calls?: readonly CalledFunctionSpec[];
}

export interface SignatureColumns {
  uses?: Readonly<{ [name in OperandName]?: readonly UseSpec[] }>;
  reads?: readonly Heap[];
  writes?: readonly Heap[];
  runsOnlyOperandCode?: boolean;
  readsStateBeforeConversions?: boolean;
  // A faster form of the next overload for some of its operands. The next one is right for them too, so a call whose operands are not known well enough to tell takes that one.
  isSpecialCase?: boolean;
  // Nothing proves the result type: native code may hand back any value. Compiled code expects the type and tests the value where it arrives.
  resultIsDeclaredOnly?: boolean;
  range?: { rule: RangeRule; operand?: OperandName };
  substringOf?: OperandName;
  typedResultForm?: { form: Exclude<TypedResultForm, "None">; source: OperandName };
  iterates?: { operand: OperandName; kind: IterationKind };
  prototypeSource?: OperandName;
  implementation?: ImplementationSpec;
  /** The C function behind the native function of the entry, which converts the operands and calls it. The operands of this overload need no conversion. */
  directEntry?: DirectEntrySpec;
  model?: FunctionRef;
  overloadUsesFeature?: FeatureUseSpec | readonly FeatureUseSpec[];
  fieldsForm?: InlineBuiltinName;
  prefixForm?: InlineBuiltinName;
  listForm?: InlineBuiltinName;
}

export interface StaticTableRef {
  file: string;
  table: string;
}

// What code of the engine asks about an entry, and few entries have. The table lists the entries of each mark, so the engine names none of them.
export const builtinMarks = [
  // A flag of the command line or an option of the engine puts it on the global object or on process.
  "IsAddedByOption",
  // Compiles text: a script or a function in the global scope of this realm, or code in a realm of its own, which has of this one what it is handed.
  "EvaluatesTextInGlobalScope",
  // Who reads it has a loader of modules in hand.
  "HoldsLoader",
  // Replaces a member of its first operand by a function of its own.
  "IsSpy",
  // Whoever goes over the enumerable properties of its holder passes it by: Object.keys, values, entries and assign, a spread, JSON.stringify.
  "IsNotEnumerable",
] as const;
export type BuiltinMark = (typeof builtinMarks)[number];

export interface EntryColumns {
  mutability?: Mutability;
  deterministic?: boolean;
  requiresHolderAsThis?: boolean;
  // Makes a second realm that runs the compiled program in the VM of its caller: one whose method table has a module host.
  startsInstance?: boolean;
  privateAlias?: boolean;
  defaultExport?: boolean;
  constructable?: boolean;
  hasSetter?: boolean;
  length?: number;
  nativeSymbols?: readonly string[];
  /** The native function behind the getter, one of nativeSymbols. It takes the realm, the receiver and the name of the property, and does not test the receiver. */
  customGetter?: string;
  /** The C function that customGetter calls with what its receiver wraps, and does nothing else. */
  directEntryOfGetter?: DirectEntrySpec;
  /** The same for a store: what the setter of the table calls with what its receiver wraps and the value. */
  directEntryOfSetter?: DirectEntrySpec;
  directEntryOfMethod?: DirectEntrySpec;
  creationSymbol?: string;
  /** The native code of the function object. A callee with this code is the function of the entry, whoever made the object. `length` goes with it. */
  functionObjectCode?: NativeCodeRef;
  linkTimeConstant?: string;
  usesFeature?: FeatureUseSpec | readonly FeatureUseSpec[];
  /** On a class whose instances only its constructor makes: the members of its prototype use the features of the class too. */
  prototypeUsesFeature?: boolean;
  runsUnseenCode?: boolean | ConditionSpec;
  /** The function has own properties that the table does not list, or something else than Function.prototype above it. */
  hasUndeclaredMembers?: boolean;
  marks?: readonly BuiltinMark[];
  /** A call of it loads machine code that nobody has seen. A report names the entry at this path, which is what a program writes. */
  loadsMachineCodeAs?: BuiltinPath;
  loads?: readonly ModuleLoadSpec[];
  callsFunctions?: readonly CalledFunctionSpec[];
  appendForm?: InlineBuiltinName;
  hostAppendSymbol?: string;
  jsonTextForm?: { argument: OperandName | number; nativeSymbol?: string; path?: BuiltinPath };
  /** The function that does the same where the argument is an object literal that nobody else sees and that has no member but `names`. */
  literalPartsForm?: { argument: number; names: readonly string[]; path: BuiltinPath };
  bodyBytesForm?: BuiltinPath;
  boxedCallStub?: BoxedStubName;
  platforms?: readonly TargetPlatform[];
}

export interface SlotSpec {
  heap: Heap;
  contentsSlot: ContentsSlot | null;
  holds?: TypeSpec;
}

export interface TypeNameSpec {
  path: readonly string[];
  isView: boolean;
  typeArguments: readonly SlotName[];
}

export interface CppClassRef {
  name: string;
  header: string;
}

export const pristineTests = ["Mark", "ClosureAsCreated", "InstanceStructure"] as const;
export type PristineTest = (typeof pristineTests)[number];

export interface ClassColumns {
  extends?: ClassName;
  jsType?: string;
  typedArrayType?: string;
  sharingMode?: SharingMode;
  isPrimitiveWrapper?: boolean;
  isNeverPristine?: boolean;
  /** How compiled code tests that an instance has gained no property and kept its prototype. Mark: start-up marks the Structure of new instances. InstanceStructure: the cell has the Structure that the realm gives a new instance. */
  pristineTest?: PristineTest;
  hasClosureInstances?: boolean;
  /** Native code makes no instance of the class but the entries that inherit from its prototype, so no result that is left undescribed is one. */
  instancesAreEntries?: boolean;
  /** The constructor puts the characters of a string on an instance, each an own read-only property under its index. The classes below do the same. */
  definesCharactersOnNewInstances?: boolean;
  /** Every own property that the constructor, or the engine later on its own, puts on an instance whose result type is unaliased. The lists of the classes above are added. */
  namesDefinedOnNewInstances?: readonly string[];
  /** What native code puts under some of those names: primitives. A name without a type may hold anything. */
  typesOfNamesDefinedOnNewInstances?: Readonly<Record<string, TypeSpec>>;
  /** Property to static member: native code calls the function the program stored under the member on the constructor to make the property. */
  namesMadeByStaticMembers?: Readonly<Record<string, string>>;
  /** The constructor reads `prototype` from new.target and nothing else, and it calls nothing that it finds on the new object, whatever code of its operands it runs. */
  constructorOnlyReadsPrototypeOfNewTarget?: boolean;
  instanceCppClass?: CppClassRef;
  prototypeCppExpression?: string;
  /** The Structure of a new instance, or null until the realm has created it: the expression creates nothing. */
  instanceStructureCppExpression?: string;
  constructorCallee?: Exclude<CalleeKind, "None" | "CustomGetter">;
  slots?: Readonly<Record<SlotName, SlotSpec>>;
  stateHeap?: Heap;
  types?: readonly TypeNameSpec[];
  lockedObjects?: readonly ("constructor" | "prototype")[];
  lockedMembers?: readonly ("constructor" | "prototype")[];
  closedToOtherNames?: readonly ("constructor" | "prototype")[];
  openNamesOfPrototype?: readonly string[];
  openNamesOfConstructor?: readonly string[];
  hasConstructor?: boolean;
  hasPrototype?: boolean;
  /** False: the constructor has no property `prototype`. The prototype object lies above the instances, and no path from the constructor leads to it. */
  constructorHoldsPrototype?: boolean;
  constructorSignaturesOf?: ClassName;
}

export const intrinsicPositions = ["Call", "Value", "Member"] as const;
export type IntrinsicPosition = (typeof intrinsicPositions)[number];

export const directiveKinds = [
  "Visibility",
  "OverriddenName",
  "LinkTimeConstant",
  "AlwaysInline",
  "Getter",
  "Constructor",
  "NakedConstructor",
] as const;
export type DirectiveKind = (typeof directiveKinds)[number];

export const promiseStatuses = ["Pending", "Fulfilled", "Rejected"] as const;
export type PromiseStatus = (typeof promiseStatuses)[number];

export const errorKinds = ["TypeError", "RangeError"] as const;
export type ErrorKind = (typeof errorKinds)[number];

export const nativeCallKinds = ["Cpp", "Rust", "NewCppFunction", "NewRustFunction", "Bindgen"] as const;
export type NativeCallKind = (typeof nativeCallKinds)[number];

export type IntrinsicSpec =
  | { intrinsic: "Operation"; opcode: string }
  | { intrinsic: "Conversion"; conversion: Exclude<Conversion, "None" | "Dictionary"> }
  | { intrinsic: "Throw"; error: ErrorKind }
  | { intrinsic: "IfAbruptCloseIterator" }
  | { intrinsic: "SymbolKey"; symbol: string }
  | { intrinsic: "HasJSType"; first: string; last: string }
  | { intrinsic: "Builtin" | "Construct"; path: BuiltinPath }
  | { intrinsic: "LinkTimeConstant" }
  | { intrinsic: "Int"; value: number; cppExpression: string }
  | { intrinsic: "Bool"; value: boolean }
  | { intrinsic: "Double"; value: number }
  | { intrinsic: "Call"; isNeverInlined: boolean }
  | { intrinsic: "PutByValDirect" | "GetOwnProperty"; privateKey: boolean }
  | { intrinsic: "Directive"; directive: DirectiveKind }
  | { intrinsic: "PrependArgument"; callee: string; argument: number }
  | { intrinsic: "HasPromiseStatus"; status: PromiseStatus }
  | { intrinsic: "NativeCall"; kind: NativeCallKind }
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
        | "LinkedFunction"
        | "Erased"
        | "BundleError";
    };
