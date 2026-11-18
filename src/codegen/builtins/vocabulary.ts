// The types in which a schema describes its natives to the table of built-ins, as far as bindgen and the schemas name them.

export type Primitive = "Undefined" | "Null" | "Boolean" | "Number" | "String" | "Symbol" | "BigInt";

export type Conversion =
  "None" | "ToBoolean" | "ToNumber" | "ToNumeric" | "ToString" | "ToPrimitive" | "ToInt32" | "ToUint32" | "Dictionary";

export type Heap = string;
export type BuiltinPath = string;
export type ClassName = string;
export type SlotName = string;
export type OperandName = "this" | (string & {});
export type MemberPath = readonly (string | null)[];
export type Freshness = "Unaliased" | "Yes";
export type NativeCallKind = "Cpp" | "NewCppFunction" | "Bindgen";

export type TypeSpec =
  | { type: "Anything"; freshness?: Freshness }
  | { type: "Never" }
  | { type: "Primitive"; primitive: Primitive; freshness?: Freshness }
  | { type: "Integers"; minimum: number; maximum: number }
  | { type: "StringLiterals"; values: readonly string[] }
  | { type: "Object"; freshness?: Freshness }
  | { type: "Function" }
  | { type: "PlainData" }
  | {
      type: "Instance";
      class: ClassName;
      contents?: Readonly<Record<SlotName, TypeSpec>>;
      isOfClassItself?: boolean;
      freshness?: Freshness;
    }
  | { type: "Layout"; layout: string; isOrdinaryObject?: boolean; freshness?: Freshness }
  | { type: "Builtin"; path: BuiltinPath }
  | { type: "Operand"; operand: OperandName }
  | { type: "Union"; members: readonly TypeSpec[] };

export interface ParameterType {
  accepted: TypeSpec;
  conversion: Conversion;
  converted: TypeSpec;
  refused: TypeSpec;
  mode: "Required" | "Optional" | "Rest";
  members: readonly string[];
}

export interface DirectForm {
  value: "Value" | "ValueOrEmpty" | "RestOfValues" | "Boolean" | "Int32" | "Double";
  cppType: string;
  type: TypeSpec;
}

export type PlaceSpec =
  | { place: "Operand"; operand: OperandName }
  | { place: "NewValue"; value: TypeSpec; holdsWhatIsThrown?: boolean }
  | { place: "NativeMemory" }
  | { place: "Member"; operand: OperandName; path: MemberPath }
  | { place: "NativeCell"; cell: string };

export type ProtocolSpec =
  | "OwnKeys"
  | "OwnValues"
  | "ToPrimitive"
  | "Iterate"
  | "PrototypeChain"
  | { named: readonly string[] }
  | { calls: readonly string[] };

export interface HandlerSpec {
  times: "Later" | "Once" | "PerEvent";
  thisValue?: PlaceSpec;
  arguments?: readonly PlaceSpec[];
  result?: "Escapes" | "Ignored";
}

export interface CallbackSpec extends HandlerSpec {
  afterwards: "WritesIntoWhatItFinds" | "TouchesOnlyWhatRowNames";
  spreadArguments?: PlaceSpec;
}

export type UseSpec =
  | { use: "Retains"; in: PlaceSpec }
  | { use: "Returns" }
  | ({ use: "Calls" } & CallbackSpec)
  | ({ use: "CallsMember"; path: MemberPath } & HandlerSpec)
  | { use: "RetainsMember"; path: MemberPath; in: PlaceSpec }
  | { use: "Creates"; value: TypeSpec; in: PlaceSpec }
  | { use: "DefinesName"; key: { key: "Names"; names: readonly string[] }; value: PlaceSpec }
  | { use: "ReadsContents" }
  | { use: "WritesContents" }
  | { use: "RetainsContents"; in: PlaceSpec; transitively?: boolean }
  | { use: "Role"; role: "MembersAreOnlyInspected" }
  | { use: "Runs"; protocols: readonly ProtocolSpec[]; on?: "ReachableObjects" }
  | { use: "Everything" };

export interface SignatureColumns {
  uses?: Readonly<{ [name in OperandName]?: readonly UseSpec[] }>;
  reads?: readonly Heap[];
  writes?: readonly Heap[];
  runsOnlyOperandCode?: boolean;
  readsStateBeforeConversions?: boolean;
  typedResultForm?: { form: "ParsedBody"; source: OperandName };
}

export interface EntryColumns {
  runsUnseenCode?: boolean;
}

export interface TypeNameSpec {
  path: readonly string[];
  isView: boolean;
  typeArguments: readonly SlotName[];
}

export interface ClassColumns {
  types?: readonly TypeNameSpec[];
  lockedMembers?: readonly ("constructor" | "prototype")[];
}
