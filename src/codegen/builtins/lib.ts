import assert from "node:assert";
import {
  DeclarationFile,
  type ConstantSpec,
  type Declaration,
  type HostReadUse,
  type LayoutFieldDeclaration,
  type LeftOutDeclaration,
  type MemberDeclaration,
  type ParameterDeclaration,
  type SignatureDeclaration,
  type TargetTextSpec,
} from "./declarations.ts";
import { targetArchitectures, type TargetArchitecture } from "./model.ts";
import { pathOfNativeBinding, pathOfNativeFunction } from "./paths.ts";
import type {
  Bound,
  BuiltinPath,
  CallbackResultUse,
  CallbackTimes,
  CalledFunctionSpec,
  CallMode,
  Capability,
  CheckedNumber,
  ClassColumns,
  ClassName,
  ConditionSpec,
  ContentsSlot,
  Conversion,
  CppClassRef,
  EntryColumns,
  FeatureName,
  Freshness,
  FunctionRef,
  HandlerSpec,
  Heap,
  HostReadContext,
  HostUseSpec,
  HostValueSpec,
  ImplementationSpec,
  InlineBuiltinName,
  IntegrityLevel,
  IntrinsicPosition,
  IntrinsicSpec,
  KeySpec,
  LayoutName,
  MemberPath,
  ModuleLoadSpec,
  NativeCallerSpec,
  NativeMentionSpec,
  OperandName,
  ParameterType,
  PlaceSpec,
  Primitive,
  PristineAspect,
  ProtocolSpec,
  Scope,
  SignatureColumns,
  SlotName,
  SlotSpec,
  StaticTableRef,
  TargetPlatform,
  TypeNameSpec,
  TypeSpec,
  UseSpec,
} from "./vocabulary.ts";
import { targetPlatforms } from "./vocabulary.ts";

export type { Declaration, HostReadUse } from "./declarations.ts";
export type { TargetArchitecture } from "./model.ts";
export type * from "./vocabulary.ts";
export { null_ as null, undefined_ as undefined };

const neverSpec: TypeSpec = { type: "Never" };
const anythingSpec: TypeSpec = { type: "Anything" };
const primitiveSpec = (primitive: Primitive): TypeSpec => ({ type: "Primitive", primitive });

function unionOf(members: readonly TypeSpec[]): TypeSpec {
  const flat = members.flatMap(member => (member.type === "Union" ? member.members : [member]));
  const kept = flat.filter(member => member.type !== "Never");
  if (kept.some(member => member.type === "Anything" && member.freshness === undefined)) return anythingSpec;
  if (kept.length === 0) return neverSpec;
  return kept.length === 1 ? kept[0] : { type: "Union", members: kept };
}

interface Coercions {
  loose?: Conversion;
  acceptedWhenLoose?: TypeSpec;
  wrap?: Conversion;
  looseWithBigInt?: Conversion;
}

export class TableType {
  readonly parameter: ParameterType;
  readonly #coercions: Coercions;

  constructor(parameter: ParameterType, coercions: Coercions = {}) {
    this.parameter = parameter;
    this.#coercions = coercions;
  }

  get spec(): TypeSpec {
    return this.parameter.accepted;
  }

  #with(changes: Partial<ParameterType>, coercions: Coercions = {}): TableType {
    return new TableType({ ...this.parameter, ...changes }, coercions);
  }

  #converting(conversion: Conversion | undefined, modifier: string, coercions: Coercions = {}): TableType {
    assert(
      this.parameter.conversion === "None",
      `${modifier}: the type already has the conversion ${this.parameter.conversion}`,
    );
    assert(conversion !== undefined, `${modifier} does not apply to this type`);
    return this.#with({ conversion }, coercions);
  }

  get loose(): TableType {
    const { loose, acceptedWhenLoose = this.parameter.accepted, looseWithBigInt } = this.#coercions;
    return this.#converting(loose, ".loose").#with({ accepted: acceptedWhenLoose }, { looseWithBigInt });
  }

  get wrap(): TableType {
    return this.#converting(this.#coercions.wrap, ".wrap");
  }

  get allowBigInt(): TableType {
    const conversion = this.#coercions.looseWithBigInt;
    assert(conversion !== undefined, ".allowBigInt follows b.f64.loose");
    const withBigInt = unionOf([this.parameter.accepted, primitiveSpec("BigInt")]);
    return this.#with({ conversion, accepted: withBigInt, converted: withBigInt });
  }

  #absentAs(absent: readonly Primitive[]): TableType {
    assert(this.parameter.mode === "Required", "the type is already optional or a rest parameter");
    const accepted = unionOf([this.parameter.accepted, ...absent.map(primitiveSpec)]);
    const converted = unionOf([this.parameter.converted, ...absent.map(primitiveSpec)]);
    return this.#with({ accepted, converted, mode: "Optional" });
  }

  get optional(): TableType {
    return this.#absentAs(["Undefined"]);
  }

  get nullable(): TableType {
    return this.#absentAs(["Undefined", "Null"]);
  }

  default(_value: unknown): TableType {
    return this.parameter.mode === "Optional" ? this : this.optional;
  }

  get rest(): TableType {
    assert(this.parameter.mode === "Required", "the type is already optional or a rest parameter");
    return this.#with({ mode: "Rest" });
  }

  refusing(...refused: readonly TableType[]): TableType {
    return this.#with({ refused: unionOf([this.parameter.refused, ...refused.map(type => type.spec)]) });
  }

  // With b.propagated: inside this type the entry raises no error about the operand.
  admitting(admitted: TableType): TableType {
    return this.#with({ admitted: admitted.spec });
  }

  or(...others: readonly TableType[]): TableType {
    for (const other of [this, ...others]) {
      assert(other.parameter.conversion === "None", ".or joins strict types: a conversion gets an overload of its own");
      assert(other.parameter.mode === "Required", ".or comes before .optional, .nullable and .rest");
    }
    const accepted = unionOf([this.spec, ...others.map(other => other.spec)]);
    return this.#with({ accepted, converted: accepted });
  }

  #instance(modifier: string): Extract<TypeSpec, { type: "Instance" }> {
    const { accepted } = this.parameter;
    assert(accepted.type === "Instance", `${modifier} follows b.instance()`);
    return accepted;
  }

  pristine(...aspects: readonly PristineAspect[]): TableType {
    assert(
      !aspects.includes("AsCreated"),
      ".pristine() names what a test at run time answers, and none answers AsCreated",
    );
    assert(
      !aspects.includes("Dense"),
      ".pristine() names what a test at run time answers, and none answers Dense: a new array is .dense",
    );
    const accepted: TypeSpec = { ...this.#instance(".pristine()"), pristine: aspects };
    return this.#with({ accepted, converted: accepted });
  }

  // Every index below the length of the new array holds a value. A result that does not say so may have holes.
  get dense(): TableType {
    const accepted: TypeSpec = { ...this.#instance(".dense"), pristine: ["Dense"] };
    return this.#with({ accepted, converted: accepted });
  }

  // What native code makes is of the class that is named and of none below it: TextEncoder.encode() makes a Uint8Array, never a Buffer. The constructor of a class needs no such word.
  get exactly(): TableType {
    const accepted: TypeSpec = { ...this.#instance(".exactly"), isOfClassItself: true };
    return this.#with({ accepted, converted: accepted });
  }

  holding(contents: Readonly<Record<SlotName, TableType>>): TableType {
    const specs = Object.fromEntries(Object.entries(contents).map(([slot, type]) => [slot, type.spec]));
    const accepted: TypeSpec = { ...this.#instance(".holding()"), contents: specs };
    return this.#with({ accepted, converted: accepted });
  }

  #allocated(freshness: Freshness): TableType {
    const mark = (spec: TypeSpec): TypeSpec => {
      switch (spec.type) {
        case "Anything":
        case "Object":
        case "Instance":
        case "InstanceOfReceiverClass":
        case "TypedArrayOfReceiverElementType":
        case "Layout":
          return { ...spec, freshness };
        case "Union":
          return { type: "Union", members: spec.members.map(mark) };
        case "Primitive":
          return spec.primitive === "Symbol" ? { ...spec, freshness } : spec;
        case "Never":
        case "Integers":
        case "StringLiterals":
        case "Function":
        case "PlainData":
        case "Builtin":
        case "Operand":
        case "Slot":
        case "IteratedValues":
        case "CallbackResult":
        case "Prototype":
          return spec;
      }
    };
    const accepted = mark(this.parameter.accepted);
    return this.#with({ accepted, converted: accepted });
  }

  get fresh(): TableType {
    return this.#allocated("Yes");
  }

  get freshUnlessSpecies(): TableType {
    return this.#allocated("UnlessSpecies");
  }

  get unaliased(): TableType {
    return this.#allocated("Unaliased");
  }
}

function strict(accepted: TypeSpec, coercions: Coercions = {}): TableType {
  return new TableType(
    { accepted, conversion: "None", converted: accepted, refused: neverSpec, mode: "Required", members: [] },
    coercions,
  );
}

export const checked = (value: number, cppExpression: string): CheckedNumber => ({ value, cppExpression });

export const any = strict(anythingSpec);
export const never = strict(neverSpec);
export const notPassed = strict(primitiveSpec("NotPassed"));
const undefined_ = strict(primitiveSpec("Undefined"));
const null_ = strict(unionOf([primitiveSpec("Undefined"), primitiveSpec("Null")]));
export const strictNull = strict(primitiveSpec("Null"));
export const bool = strict(primitiveSpec("Boolean"), { loose: "ToBoolean" });
export const f64 = strict(primitiveSpec("Number"), { loose: "ToNumber", looseWithBigInt: "ToNumeric" });
export const string = strict(primitiveSpec("String"), { loose: "ToString" });
export const symbol = strict(primitiveSpec("Symbol"));
export const bigint = strict(primitiveSpec("BigInt"), { loose: "ToBigInt" });
export const object = strict({ type: "Object" }, { loose: "ToObject" });
export const callable = strict({ type: "Function" });
export const primitiveValue = strict(
  unionOf((["Undefined", "Null", "Boolean", "Number", "String", "Symbol", "BigInt"] as const).map(primitiveSpec)),
  { loose: "ToPrimitive" },
);
export const propertyKey = strict(unionOf([primitiveSpec("String"), primitiveSpec("Symbol")]), {
  loose: "ToPropertyKey",
});
export const plainData = strict({ type: "PlainData" });

const integers = (minimum: Bound, maximum: Bound, coercions: Coercions = {}) =>
  strict({ type: "Integers", minimum, maximum }, coercions);
const maxSafeInteger = Number.MAX_SAFE_INTEGER;
export const int = (minimum: Bound, maximum: Bound) => integers(minimum, maximum);
export const i32 = integers(-(2 ** 31), 2 ** 31 - 1, { wrap: "ToInt32" });
export const u32 = integers(0, 2 ** 32 - 1, { wrap: "ToUint32" });
export const integer = strict(primitiveSpec("Number"), { loose: "ToIntegerOrInfinity" });
export const length = integers(0, maxSafeInteger, { loose: "ToLength", acceptedWhenLoose: primitiveSpec("Number") });
export const index = integers(0, maxSafeInteger, { loose: "ToIndex", acceptedWhenLoose: primitiveSpec("Number") });

export const enumeration = (values: readonly string[]) => strict({ type: "StringLiterals", values });
export const instance = (className: ClassName) => strict({ type: "Instance", class: className });
export const layoutOf = (layout: LayoutName) => strict({ type: "Layout", layout });
export const ordinaryObjectOf = (layout: LayoutName) => strict({ type: "Layout", layout, isOrdinaryObject: true });
export const builtin = (path: BuiltinPath) => strict({ type: "Builtin", path });
export const sameClass = strict({ type: "InstanceOfReceiverClass" });
export const sameElementType = strict({ type: "TypedArrayOfReceiverElementType" });
export const operand = (name: OperandName) => strict({ type: "Operand", operand: name });
export const slot = (name: OperandName, slotName: SlotName) => strict({ type: "Slot", operand: name, slot: slotName });
export const iterated = (name: OperandName) => strict({ type: "IteratedValues", operand: name });
export const settled = (name: OperandName) => strict({ type: "IteratedValues", operand: name, isSettled: true });
export const callbackResult = (name: OperandName) => strict({ type: "CallbackResult", operand: name });
export const prototype = (name: OperandName) => strict({ type: "Prototype", operand: name });
export const union = (first: TableType, ...others: readonly TableType[]) => first.or(...others);

export function dictionary(members: readonly string[]): TableType {
  assert(members.length > 0, "a dictionary needs at least one member");
  return new TableType({
    accepted: neverSpec,
    conversion: "Dictionary",
    converted: { type: "Object" },
    refused: neverSpec,
    mode: "Required",
    members,
  });
}

export type PlaceLike = TableType | PlaceSpec;

function placeOf(place: PlaceLike): PlaceSpec {
  if (!(place instanceof TableType)) {
    // Nobody type-checks a declaration file before it runs, and what is no place would count as none.
    assert(
      typeof place === "object" && place !== null && "place" in place,
      `${JSON.stringify(place)} is no place: an operand is b.operand("name")`,
    );
    return place;
  }
  const { spec } = place;
  switch (spec.type) {
    case "Operand":
      return { place: "Operand", operand: spec.operand };
    case "Slot":
      return { place: "Slot", operand: spec.operand, slot: spec.slot };
    case "IteratedValues":
      return { place: "IteratedValues", operand: spec.operand, isSettled: spec.isSettled };
    case "Prototype":
      return { place: "Prototype", operand: spec.operand };
    case "Anything":
    case "Never":
    case "Primitive":
    case "Integers":
    case "StringLiterals":
    case "Object":
    case "Function":
    case "PlainData":
    case "Instance":
    case "InstanceOfReceiverClass":
    case "TypedArrayOfReceiverElementType":
    case "Layout":
    case "Builtin":
    case "CallbackResult":
    case "Union":
      return { place: "NewValue", value: spec };
  }
}

export const result: PlaceSpec = { place: "Result" };
export const nativeMemory: PlaceSpec = { place: "NativeMemory" };
export const resultSlot = (slotName: SlotName): PlaceSpec => ({ place: "ResultSlot", slot: slotName });
export const resultField = (field: string | number): PlaceSpec => ({ place: "ResultField", field });
// For a record that stores into the field: the field holds what the records of the overload store there and nothing else, whatever its type allows.
export const resultFieldHoldingOnlyWhatIsStored = (field: string | number): PlaceSpec => ({
  place: "ResultField",
  field,
  holdsOnlyWhatIsStored: true,
});
export const ownValues = (name: OperandName): PlaceSpec => ({ place: "OwnValues", operand: name });
// Memory of native code that JavaScript reaches only through the entries that name the cell. There is one per name in a program.
export const nativeCell = (cell: string): PlaceSpec => ({ place: "NativeCell", cell });
export const everyOwnValue = null;

export const keyFrom = (name: OperandName): KeySpec => ({ key: "Operand", operand: name });
export const keysIn = (name: OperandName): KeySpec => ({ key: "ElementsOf", operand: name });
export const keysNamed = (...names: readonly string[]): KeySpec => ({ key: "Names", names });
export const indexKeys: KeySpec = { key: "Indexes" };
export const anyKey: KeySpec = { key: "Any" };

export const inspected: readonly UseSpec[] = [];
export const everything: UseSpec = { use: "Everything" };
export const retained: UseSpec = { use: "Retains", in: nativeMemory };
// An operand that a function of the host reads, calls, keeps and passes on like any native code, and does not change.
export const handedOver: readonly UseSpec[] = [retained];
export const returned: UseSpec = { use: "Returns" };
export const movesElements: UseSpec = { use: "MovesElements" };
export const evaluatedAsText: UseSpec = { use: "Role", role: "EvaluatedAsText" };
export const loadedAsModule: UseSpec = { use: "Role", role: "ModuleSpecifier" };
export const readAsCharacters: UseSpec = { use: "Role", role: "ReadAsCharacters" };
export const readAsLocale: UseSpec = { use: "Role", role: "Locale" };
export const contentKey: UseSpec = { use: "Role", role: "ContentKey" };
export const replacesContents: UseSpec = { use: "Role", role: "ReplacesContents" };
// Anything but 0 may be above the length the receiver has, and then the indexes in between are holes.
export const becomesLengthOfReceiver: UseSpec = { use: "Role", role: "BecomesLengthOfReceiver" };
// The new array has a hole wherever this operand has one in the part that is copied.
export const copiesHolesToResult: UseSpec = { use: "Role", role: "CopiesHolesToResult" };
export const membersOnlyInspected: UseSpec = { use: "Role", role: "MembersAreOnlyInspected" };
// Native code tests that a value is an object before it reads or calls a member of it, by name or to iterate over it: `(404).status` and `"OK"[Symbol.iterator]` are never looked up.
export const membersOfObjectsOnly: UseSpec = { use: "Role", role: "MembersAreOfObjectsOnly" };
// Native code tests that a value it means to call is callable, and keeps it.
export const functionsConvertedUnderNamesOnly: UseSpec = { use: "Role", role: "FunctionsAreConvertedUnderNamesOnly" };
export const ownPropertyTraps: readonly UseSpec[] = [
  { use: "Runs", protocols: ["OwnKeys"] },
  { use: "Role", role: "KeysAreNotListed" },
];
export const storedIn = (place: PlaceLike): UseSpec => ({ use: "Retains", in: placeOf(place) });
export const readsContents = (slotName?: SlotName): UseSpec => ({ use: "ReadsContents", slot: slotName });
export const writesContents = (slotName?: SlotName): UseSpec => ({ use: "WritesContents", slot: slotName });
export const contentsStoredIn = (place: PlaceLike): UseSpec => ({ use: "RetainsContents", in: placeOf(place) });
export const settledValuesStoredIn = (place: PlaceLike): UseSpec => ({
  use: "RetainsSettledValues",
  in: placeOf(place),
});
// What an iteration over the operand hands out, whatever kind of iterable it is.
export const iteratedValuesStoredIn = (place: PlaceLike): UseSpec => ({
  use: "RetainsIteratedValues",
  in: placeOf(place),
});
export const reachableValuesStoredIn = (place: PlaceLike): UseSpec => ({
  use: "RetainsContents",
  in: placeOf(place),
  transitively: true,
});
export const readByKey = (key: KeySpec, to: PlaceLike = result): UseSpec => ({
  use: "ReadsByKey",
  key,
  to: placeOf(to),
});
export const storedByKey = (key: KeySpec, value: PlaceLike): UseSpec => ({
  use: "StoresByKey",
  key,
  value: placeOf(value),
});
export const deletedByKey = (key: KeySpec): UseSpec => ({ use: "DeletesByKey", key });
// The answer depends on whether the object has the property, and nothing of its value is read.
export const testedByKey = (key: KeySpec): UseSpec => ({ use: "TestsByKey", key });
export const assignedFrom = (sources: OperandName): UseSpec => ({ use: "AssignsFrom", sources });
// Each own property of the source is defined on the object as it stands on the source, an accessor as an accessor: no getter runs.
export const definedFrom = (source: OperandName): UseSpec => ({ use: "DefinesFrom", source });
export const definesName = (key: readonly string[] | KeySpec, value: PlaceLike): UseSpec => ({
  use: "DefinesName",
  key: "key" in key ? key : keysNamed(...key),
  value: placeOf(value),
});
export const definesAccessor = (accessor: "Getter" | "Setter", key: KeySpec, value: PlaceLike): UseSpec => ({
  use: `Defines${accessor}`,
  key,
  value: placeOf(value),
});
export const accessorReadByKey = (accessor: "Getter" | "Setter", key: KeySpec, to: PlaceLike = result): UseSpec => ({
  use: `Reads${accessor}`,
  key,
  to: placeOf(to),
});
export const definedBy = (key: KeySpec, descriptor: OperandName): UseSpec => ({
  use: "TakesDescriptor",
  key,
  descriptor,
});
export const definedByMap = (descriptors: OperandName): UseSpec => ({ use: "TakesDescriptorMap", descriptors });
// The result is a map of descriptors of the own properties of the object: whoever is defined by that map gets those properties.
export const describedByResult: UseSpec = { use: "DescribesOwnProperties" };
// The operand is a map of descriptors, and the object that the call makes and returns gets the properties that it describes.
export const describesResult: UseSpec = { use: "DescribesResult" };
export const integrityRaisedTo = (level: IntegrityLevel): UseSpec => ({ use: "ChangesIntegrity", level });
export const prototypeSetTo = (to: OperandName): UseSpec => ({ use: "ChangesPrototype", to });
export const prototypeOf = (of: PlaceLike): UseSpec => ({ use: "BecomesPrototype", of: placeOf(of) });
export const named = (...names: readonly string[]): ProtocolSpec => ({ named: names });
export const calls = (...names: readonly string[]): ProtocolSpec => ({ calls: names });
export const runs = (...protocols: readonly ProtocolSpec[]): UseSpec => ({ use: "Runs", protocols });
export const runsTransitively = (...protocols: readonly ProtocolSpec[]): UseSpec => ({
  use: "Runs",
  protocols,
  on: "ReachableObjects",
});
export const runsOnContents = (...protocols: readonly ProtocolSpec[]): UseSpec => ({
  use: "Runs",
  protocols,
  on: "Contents",
});
export const localeList: readonly UseSpec[] = [
  readAsLocale,
  runsTransitively("OwnValues", "PrototypeChain", "ToPrimitive", named("length")),
];
// No locale, or a tag out of a list of well-formed ones: there is nothing to convert and nothing to refuse. A tag that is not listed may be as good: nobody has looked at it.
export const hostLocaleOrWellFormedTag = union(
  undefined_,
  enumeration(
    (
      "und en en-US en-GB en-CA en-AU en-IN en-NZ en-IE en-ZA de de-DE de-AT de-CH fr fr-FR fr-CA fr-CH fr-BE es es-ES es-MX es-AR es-419 " +
      "it it-IT pt pt-BR pt-PT nl nl-NL nl-BE sv sv-SE da da-DK nb nb-NO no fi fi-FI is pl pl-PL cs cs-CZ sk hu hu-HU ro ro-RO bg el el-GR " +
      "ru ru-RU uk uk-UA tr tr-TR he he-IL ar ar-EG ar-SA fa hi hi-IN bn th th-TH vi vi-VN id id-ID ms ja ja-JP ko ko-KR zh zh-CN zh-TW zh-HK " +
      "zh-Hans zh-Hant"
    ).split(" "),
  ),
).optional;
export const optionBag = (names: readonly string[]): UseSpec[] => [runsTransitively("ToPrimitive", named(...names))];
// The language turns a primitive given for the options into an object and reads its members. Bun's natives do not.
export const hostOptionBag = (names: readonly string[]): UseSpec[] => [...optionBag(names), membersOfObjectsOnly];

// What console.log's formatter does with a value, which Bun.inspect and the messages of some errors share.
export const printedByFormatter = (...otherMembers: readonly string[]): UseSpec =>
  runsTransitively(
    "OwnKeys",
    "OwnValues",
    "PrototypeChain",
    "Iterate",
    "ToPrimitive",
    calls("@@@nodejs.util.inspect.custom", "toISOString", "toJSON"),
    named(
      ...otherMembers,
      "@@toStringTag",
      "cause",
      "children",
      "data",
      "error",
      "errors",
      "key",
      "length",
      "line",
      "message",
      "name",
      "originalLine",
      "props",
      "size",
      "sourceURL",
      "stack",
      "type",
    ),
  );

export interface CallbackOptions {
  times: CallbackTimes;
  constructs?: boolean;
  /** What the constructed function sees as new.target. Without it that is the function itself. */
  newTarget?: PlaceLike;
  this?: PlaceLike;
  args?: readonly PlaceLike[];
  spreadArgs?: PlaceLike;
  result?: CallbackResultUse;
  resultTo?: PlaceLike;
}

export function called(options: CallbackOptions): UseSpec {
  assert((options.result === "Stored") === (options.resultTo !== undefined), 'resultTo goes with result: "Stored"');
  assert(options.newTarget === undefined || options.constructs === true, "newTarget goes with constructs: true");
  return {
    use: "Calls",
    times: options.times,
    constructs: options.constructs,
    newTarget: options.newTarget === undefined ? undefined : placeOf(options.newTarget),
    thisValue: options.this === undefined ? undefined : placeOf(options.this),
    arguments: options.args?.map(placeOf),
    spreadArguments: options.spreadArgs === undefined ? undefined : placeOf(options.spreadArgs),
    result: options.result,
    resultTo: options.resultTo === undefined ? undefined : placeOf(options.resultTo),
  };
}

export interface HandlerOptions {
  times: CallbackTimes;
  this?: PlaceLike;
  args?: readonly PlaceLike[];
  result?: "Escapes" | "Ignored";
}

const handlerSpecOf = (options: HandlerOptions): HandlerSpec => ({
  times: options.times,
  thisValue: options.this === undefined ? undefined : placeOf(options.this),
  arguments: options.args?.map(placeOf),
  result: options.result,
});

// Native code calls what it finds at the end of the path, which starts at the operand.
export const memberCalled = (path: MemberPath, options: HandlerOptions): UseSpec => ({
  use: "CallsMember",
  path,
  ...handlerSpecOf(options),
});
export const keptCalled = (cell: string, options: HandlerOptions): UseSpec => ({
  use: "CallsKept",
  cell,
  ...handlerSpecOf(options),
});
export const memberStoredIn = (path: MemberPath, place: PlaceLike): UseSpec => ({
  use: "RetainsMember",
  path,
  in: placeOf(place),
});
// Native code makes the value and keeps it there.
export const createdIn = (value: TableType, place: PlaceLike): UseSpec => ({
  use: "Creates",
  value: value.spec,
  in: placeOf(place),
});
// The objects of the result are the ones in the cell. The declared result says which primitives there are beside them.
export const returnedFrom = (cell: string): UseSpec => ({ use: "ReturnsKept", cell });

export const functionIn = (file: string, name: string): FunctionRef => ({ file, name });
export const generic: ImplementationSpec = { how: "Generic" };
export const hostCall: ImplementationSpec & { how: "HostCall" } = { how: "HostCall" };
// The getter has no function object until somebody asks for its descriptor.
export const customGetterCall = (symbol: string): ImplementationSpec & { how: "HostCall" } => ({
  how: "HostCall",
  customGetter: symbol,
});

export interface CompiledOptions {
  stubConvention?: boolean;
}

export const compiled = (
  file: string,
  name: string,
  options: CompiledOptions = {},
): ImplementationSpec & { how: "Compiled" } => ({
  how: "Compiled",
  function: { file, name },
  usesStubConvention: options.stubConvention,
});

export interface InlineOptions {
  parameters?: readonly (string | number)[];
  max?: number;
  otherwise?: (ImplementationSpec & { how: "HostCall" }) | (ImplementationSpec & { how: "Compiled" });
}

export const inline = (name: InlineBuiltinName, options: InlineOptions = {}): ImplementationSpec => ({
  how: "Inline",
  builtin: name,
  parameters: options.parameters ?? [],
  maximumArgumentCount: options.max,
  otherwise: options.otherwise ?? { how: "Nothing" },
});

function conditionOn(name: OperandName, isOneOf: readonly string[], startsWith: readonly string[]): ConditionSpec {
  assert(isOneOf.length + startsWith.length > 0, `a condition on ${name} needs at least one string`);
  return { operand: name, isOneOf, startsWith };
}

export const whenOperand = (name: OperandName, ...isOneOf: readonly string[]) => conditionOn(name, isOneOf, []);
// Native code acts only where the method is called on that entry: an object that inherits the method, or borrows it, has nothing behind it.
export const whenOperandOfCallOn = (
  receiver: BuiltinPath,
  name: OperandName,
  ...isOneOf: readonly string[]
): ConditionSpec => ({
  ...conditionOn(name, isOneOf, []),
  calledOn: receiver,
});
export const whenOperandStartsWith = (name: OperandName, ...prefixes: readonly string[]) =>
  conditionOn(name, [], prefixes);
// The operand may be an object that has a property of this name, its own or inherited. An object nobody knows may have it.
export const whenOperandHasProperty = (name: OperandName, property: string): ConditionSpec => ({
  operand: name,
  hasProperty: property,
});
export const whenBuildAdmitsRuntimeCode: ConditionSpec = { buildAdmitsRuntimeCode: true };
// The overload that takes the call says that it runs JavaScript which no operand names.
export const whenCallRunsOtherCode: ConditionSpec = { callRunsOtherCode: true };
// The entry answers an object that the table does not describe, and native code acts when a property of that object is stored or defined.
export const whenObjectNobodyKnowsIsWritten: ConditionSpec = { objectNobodyKnowsIsWritten: true };

// The target of a build decides which of the types it is: every run of an executable sees the same one.
export type TypeByPlatform = Readonly<Record<TargetPlatform, TableType>>;

// With operands that it admits (.admitting(), or else all that it accepts) the entry has no step of its own that throws: no RangeError for a number, no SyntaxError for a text, no TypeError for the state of an object.
export const propagated = "Propagated";

export interface SignatureOptions extends SignatureColumns {
  this?: TableType;
  args?: Readonly<Record<string, TableType>>;
  returns?: TableType | TypeByPlatform;
  // Every own property that the new object has and an instance fresh from the constructor of its class has not.
  resultProperties?: Readonly<Record<string, TableType>>;
  prefixProperties?: Readonly<Record<string, TableType>>;
  capability: Capability;
  throws?: boolean | typeof propagated;
}

export interface UndeclaredSignature {
  otherwise: true;
  implementation?: ImplementationSpec;
}

export const otherwise: UndeclaredSignature = { otherwise: true };
export const otherwiseBy = (implementation: ImplementationSpec): UndeclaredSignature => ({
  otherwise: true,
  implementation,
});

export type FunctionField = (SignatureOptions & EntryColumns) | UndeclaredSignature;

export interface SetterOptions extends Omit<SignatureOptions, "args" | "returns"> {
  value: TableType;
}

export interface GetterField extends Omit<SignatureOptions, "args" | "returns">, EntryColumns {
  getter: TableType | TypeByPlatform;
  setter?: SetterOptions;
  call?: FunctionField | readonly FunctionField[];
}

export interface OwnSlotOptions {
  // The getter of JSGlobalObject that answers the Structure an instance has before its constructor defines a property.
  structure: string;
  // The properties that the constructor defines ahead of this one, in that order.
  after: readonly string[];
}

// An own data property that the constructor of a class defines.
export const ownSlot = (holds: TableType, { structure, after }: OwnSlotOptions): GetterField => ({
  getter: holds,
  capability: "js",
  throws: true,
  runsOnlyOperandCode: true,
  implementation: { how: "OwnSlot", structure, after },
});

export class ConstantField {
  readonly constant: ConstantSpec;
  constructor(constant: ConstantSpec) {
    this.constant = constant;
  }
}

export interface PropertyOptions extends EntryColumns, Pick<GetterField, "setter" | "call" | "uses"> {
  createdOnFirstRead?: Pick<SignatureOptions, "capability" | "throws" | "uses" | "reads">;
}

export class PropertyField {
  readonly holds: TableType | TypeByPlatform;
  readonly options: PropertyOptions;
  constructor(holds: TableType | TypeByPlatform, options: PropertyOptions) {
    this.holds = holds;
    this.options = options;
  }
}

export function constant(value: number | undefined | CheckedNumber): ConstantField {
  if (value === undefined) return new ConstantField({ constant: "Undefined" });
  if (typeof value === "number") return new ConstantField({ constant: "Number", value, cppExpression: null });
  return new ConstantField({ constant: "Number", value: value.value, cppExpression: value.cppExpression });
}

export type TextByTarget = Readonly<Partial<Record<TargetPlatform | TargetArchitecture, string>>>;

function textsByTarget(texts: TextByTarget): TargetTextSpec[] {
  const targets: readonly string[] = [...targetPlatforms, ...targetArchitectures];
  for (const key of Object.keys(texts))
    assert(targets.includes(key), `${key} is neither a platform nor an architecture`);
  const byPlatform = targetPlatforms.flatMap((platform): TargetTextSpec[] => {
    const text = texts[platform];
    return text === undefined ? [] : [{ text, platforms: [platform], architectures: targetArchitectures }];
  });
  const byArchitecture = targetArchitectures.flatMap((architecture): TargetTextSpec[] => {
    const text = texts[architecture];
    return text === undefined ? [] : [{ text, platforms: targetPlatforms, architectures: [architecture] }];
  });
  assert(
    byPlatform.length === 0 || byArchitecture.length === 0,
    "the platform or the architecture decides a text, not both",
  );
  return [...byPlatform, ...byArchitecture];
}

// A text that the target of a build decides: every run of an executable reads the same one.
export function constantString(value: string | TextByTarget): ConstantField {
  const texts =
    typeof value === "string"
      ? [{ text: value, platforms: targetPlatforms, architectures: targetArchitectures }]
      : textsByTarget(value);
  return new ConstantField({ constant: "String", texts });
}
export const wellKnownSymbol = new ConstantField({ constant: "Symbol" });
export const property = (holds: TableType | TypeByPlatform = any, options: PropertyOptions = {}) =>
  new PropertyField(holds, options);

export type Field =
  FunctionField | readonly FunctionField[] | GetterField | readonly GetterField[] | ConstantField | PropertyField;

const entryColumnKeys = [
  "mutability",
  "deterministic",
  "requiresHolderAsThis",
  "startsInstance",
  "privateAlias",
  "defaultExport",
  "constructable",
  "length",
  "nativeSymbols",
  "customGetter",
  "directEntryOfGetter",
  "directEntryOfSetter",
  "directEntryOfMethod",
  "creationSymbol",
  "functionObjectCode",
  "linkTimeConstant",
  "usesFeature",
  "prototypeUsesFeature",
  "runsUnseenCode",
  "hasUndeclaredMembers",
  "marks",
  "loadsMachineCodeAs",
  "loads",
  "callsFunctions",
  "appendForm",
  "hostAppendSymbol",
  "jsonTextForm",
  "literalPartsForm",
  "bodyBytesForm",
  "boxedCallStub",
  "platforms",
] as const satisfies readonly (keyof EntryColumns)[];

const signatureColumnKeys = [
  "uses",
  "reads",
  "writes",
  "runsOnlyOperandCode",
  "readsStateBeforeConversions",
  "isSpecialCase",
  "resultIsDeclaredOnly",
  "range",
  "substringOf",
  "typedResultForm",
  "iterates",
  "prototypeSource",
  "implementation",
  "directEntry",
  "model",
  "overloadUsesFeature",
  "fieldsForm",
  "prefixForm",
  "listForm",
] as const satisfies readonly (keyof SignatureColumns)[];

const signatureKeys = [
  "this",
  "args",
  "returns",
  "resultProperties",
  "prefixProperties",
  "capability",
  "throws",
  ...signatureColumnKeys,
] as const satisfies readonly (keyof SignatureOptions)[];

const functionFieldKeys: readonly string[] = [...signatureKeys, ...entryColumnKeys];

function assertColumns(path: BuiltinPath, written: object, known: readonly string[]): void {
  for (const key of Object.keys(written)) {
    assert(known.includes(key), `${path}: ${key} is not a column of this declaration`);
  }
}

function pick<T extends object, K extends keyof T>(from: T, keys: readonly K[]): Pick<T, K> {
  const picked = {} as Pick<T, K>;
  for (const key of keys) if (from[key] !== undefined) picked[key] = from[key];
  return picked;
}

/** `field` without what applies to every overload, for another overload that is made of it. */
export function withoutEntryColumns<Field extends EntryColumns>(field: Field): Omit<Field, keyof EntryColumns> {
  const isEntryColumn = (key: string) => (entryColumnKeys as readonly string[]).includes(key);
  return Object.fromEntries(Object.entries(field).filter(([key]) => !isEntryColumn(key))) as Omit<
    Field,
    keyof EntryColumns
  >;
}

function collectEntryColumns(path: BuiltinPath, fields: readonly EntryColumns[]): EntryColumns {
  const columns: EntryColumns = {};
  for (const field of fields) {
    for (const [key, value] of Object.entries(pick(field, entryColumnKeys))) {
      assert(!(key in columns), `${path}: ${key} applies to every overload, so it is written once`);
      Object.assign(columns, { [key]: value });
    }
  }
  return columns;
}

function undeclaredSignature(mode: CallMode, field: UndeclaredSignature): SignatureDeclaration {
  return {
    mode,
    receiver: null,
    parameters: [{ name: "operands", type: any.rest.parameter }],
    result: anythingSpec,
    capability: "js",
    throws: true,
    isUndeclared: true,
    implementation: field.implementation,
  };
}

function resultsOf(
  path: BuiltinPath,
  returns: TableType | TypeByPlatform = undefined_,
): Pick<SignatureDeclaration, "result" | "resultsByPlatform"> {
  if (returns instanceof TableType) return { result: returns.spec };
  const resultsByPlatform = targetPlatforms.map(platform => {
    const type: unknown = returns[platform];
    assert(type instanceof TableType, `${path}: there is no type for ${platform}`);
    return { platform, result: type.spec };
  });
  return { result: unionOf(resultsByPlatform.map(({ result }) => result)), resultsByPlatform };
}

function signatureOf(
  path: BuiltinPath,
  mode: CallMode,
  field: FunctionField,
  known: readonly string[] = functionFieldKeys,
): SignatureDeclaration {
  if ("otherwise" in field) return undeclaredSignature(mode, field);
  assertColumns(path, field, known);
  const parameters = Object.entries(field.args ?? {}).map(([name, type]): ParameterDeclaration => ({
    name,
    type: type.parameter,
  }));
  return {
    ...pick(field, signatureColumnKeys),
    mode,
    receiver: field.this?.parameter ?? null,
    parameters,
    ...resultsOf(path, field.returns),
    resultProperties: Object.entries(field.resultProperties ?? {}).map(([name, type]) => ({ name, type: type.spec })),
    prefixProperties: Object.entries(field.prefixProperties ?? {}).map(([name, type]) => ({ name, type: type.spec })),
    capability: field.capability,
    throws: (field.throws ?? false) !== false,
    onlyPropagatesErrors: field.throws === propagated,
    isUndeclared: false,
  };
}

const overloadsOf = (field: FunctionField | readonly FunctionField[]): readonly FunctionField[] =>
  Array.isArray(field) ? (field as readonly FunctionField[]) : [field as FunctionField];

const declaredColumns = (fields: readonly FunctionField[]): EntryColumns[] =>
  fields.flatMap(field => ("otherwise" in field ? [] : [field]));

type MemberKind = MemberDeclaration["kind"];

function memberWith(path: BuiltinPath, kind: MemberKind, parts: Partial<MemberDeclaration>): MemberDeclaration {
  return {
    declares: "Member",
    path,
    kind,
    isOwnPropertyOfInstances: false,
    isLazilyCreated: false,
    signatures: [],
    dispatches: [],
    constant: null,
    length: null,
    columns: {},
    ...parts,
  };
}

function accessorMember(path: BuiltinPath, kind: MemberKind, ...fields: readonly GetterField[]): MemberDeclaration {
  const calls = fields.flatMap(({ call }) => (call === undefined ? [] : overloadsOf(call)));
  const signatures = [
    ...fields.map(({ getter, setter, call, ...rest }) => signatureOf(path, "Get", { ...rest, returns: getter })),
    ...fields.flatMap(({ setter }) => {
      if (setter === undefined) return [];
      const { value, ...rest } = setter;
      return [signatureOf(path, "Set", { ...rest, args: { value } }, signatureKeys)];
    }),
    ...calls.map(overload => signatureOf(path, "Call", overload)),
  ];
  return memberWith(path, kind, {
    signatures,
    columns: collectEntryColumns(path, [...fields, ...declaredColumns(calls)]),
  });
}

function gettersOf(field: Field): readonly GetterField[] | null {
  const fields: readonly object[] = Array.isArray(field) ? field : [field];
  return fields.length > 0 && fields.every(overload => "getter" in overload)
    ? (fields as readonly GetterField[])
    : null;
}

function memberOf(path: BuiltinPath, functionKind: "Function" | "Method", field: Field): MemberDeclaration {
  if (field instanceof ConstantField) return memberWith(path, "Constant", { constant: field.constant });
  if (field instanceof PropertyField) {
    const { createdOnFirstRead, ...options } = field.options;
    const getter: GetterField = {
      ...options,
      getter: field.holds,
      capability: "none",
      ...createdOnFirstRead,
      implementation: generic,
    };
    return { ...accessorMember(path, "DataProperty", getter), isLazilyCreated: createdOnFirstRead !== undefined };
  }
  const getters = gettersOf(field);
  if (getters !== null) return accessorMember(path, "Accessor", ...getters);
  const overloads = overloadsOf(field as FunctionField | readonly FunctionField[]);
  return memberWith(path, functionKind, {
    signatures: overloads.map(overload => signatureOf(path, "Call", overload)),
    columns: collectEntryColumns(path, declaredColumns(overloads)),
  });
}

const membersOf = (holder: BuiltinPath, functionKind: "Function" | "Method", fields: Readonly<Record<string, Field>>) =>
  Object.entries(fields).map(([name, field]) => memberOf(`${holder}.${name}`, functionKind, field));

export const contents = (contentsSlot: ContentsSlot, heap: Heap, holds?: TableType): SlotSpec => ({
  heap,
  contentsSlot,
  holds: holds?.spec,
});
export const state = (heap: Heap, holds?: TableType): SlotSpec => ({ heap, contentsSlot: null, holds: holds?.spec });
export const exactType = (path: string, ...typeArguments: readonly SlotName[]): TypeNameSpec => ({
  path: path.split("."),
  isView: false,
  typeArguments,
});
export const viewType = (path: string, ...typeArguments: readonly SlotName[]): TypeNameSpec => ({
  path: path.split("."),
  isView: true,
  typeArguments,
});
export const cppClass = (name: string, header = `${name}.h`): CppClassRef => ({ name, header });
export const typesByName = (types: Readonly<Record<string, TableType>>): Readonly<Record<string, TypeSpec>> =>
  Object.fromEntries(Object.entries(types).map(([name, type]) => [name, type.spec]));
export const staticTable = (file: string, table: string): StaticTableRef => ({ file, table });
export const membersFrom = (holder: BuiltinPath, table: StaticTableRef | undefined): Declaration[] =>
  table === undefined ? [] : [{ declares: "StaticTable", holder, table }];

export interface ClassOptions extends ClassColumns, EntryColumns {
  call?: FunctionField | readonly FunctionField[];
  construct?: FunctionField | readonly FunctionField[];
  static?: Readonly<Record<string, Field>>;
  proto?: Readonly<Record<string, Field>>;
  instance?: Readonly<Record<string, GetterField>>;
  constructorTable?: StaticTableRef;
  prototypeTable?: StaticTableRef;
}

const classColumnKeys = [
  "extends",
  "jsType",
  "typedArrayType",
  "sharingMode",
  "isPrimitiveWrapper",
  "isNeverPristine",
  "pristineTest",
  "hasClosureInstances",
  "instancesAreEntries",
  "definesCharactersOnNewInstances",
  "namesDefinedOnNewInstances",
  "typesOfNamesDefinedOnNewInstances",
  "namesMadeByStaticMembers",
  "constructorOnlyReadsPrototypeOfNewTarget",
  "instanceCppClass",
  "prototypeCppExpression",
  "instanceStructureCppExpression",
  "constructorCallee",
  "slots",
  "stateHeap",
  "types",
  "lockedObjects",
  "lockedMembers",
  "closedToOtherNames",
  "openNamesOfPrototype",
  "openNamesOfConstructor",
  "hasConstructor",
  "hasPrototype",
  "constructorHoldsPrototype",
  "constructorSignaturesOf",
] as const satisfies readonly (keyof ClassColumns)[];

const classOptionKeys = [
  ...classColumnKeys,
  ...entryColumnKeys,
  "call",
  "construct",
  "static",
  "proto",
  "instance",
  "constructorTable",
  "prototypeTable",
] as const satisfies readonly (keyof ClassOptions)[];

const classNameOf = (path: BuiltinPath): ClassName => path.replaceAll("%", "");

// An instance without the Structure of an own slot is read by name, which looks along its prototypes and may run a getter.
function instanceFieldOf(name: string, field: GetterField): GetterField {
  if (field.implementation?.how !== "OwnSlot") return field;
  return { ...field, uses: { this: [readByKey(keysNamed(name)), runs("PrototypeChain")], ...field.uses } };
}

function class_(path: BuiltinPath, options: ClassOptions): Declaration[] {
  assertColumns(path, options, classOptionKeys);
  const calls = options.call === undefined ? [] : overloadsOf(options.call);
  const constructs = options.construct === undefined ? [] : overloadsOf(options.construct);
  const signatures = [
    ...calls.map(overload => signatureOf(path, "Call", overload)),
    ...constructs.map(overload => signatureOf(path, "Construct", overload)),
  ];
  const prototype = `${path}.prototype`;
  const instanceMembers = Object.entries(options.instance ?? {}).map(([name, field]) => ({
    ...accessorMember(`${prototype}.${name}`, "DataProperty", instanceFieldOf(name, field)),
    isOwnPropertyOfInstances: true,
  }));
  return [
    {
      declares: "Class",
      path,
      name: classNameOf(path),
      columns: pick(options, classColumnKeys),
      entryColumns: collectEntryColumns(path, [options, ...declaredColumns([...calls, ...constructs])]),
    },
    ...membersFrom(path, options.constructorTable),
    ...membersFrom(prototype, options.prototypeTable),
    ...(signatures.length > 0 ? [memberWith(path, "Constructor", { signatures })] : []),
    ...membersOf(path, "Function", options.static ?? {}),
    ...membersOf(prototype, "Method", options.proto ?? {}),
    ...instanceMembers,
  ];
}
export { class_ as class };

export function typedArrayClass(elementName: string, bytesPerElement: number): Declaration[] {
  const bytes = constant(checked(bytesPerElement, `elementSize(Type${elementName})`));
  return class_(`${elementName}Array`, {
    extends: "TypedArray",
    jsType: `${elementName}ArrayType`,
    typedArrayType: `Type${elementName}`,
    constructorSignaturesOf: "TypedArray",
    lockedMembers: ["constructor", "prototype"],
    // core-js 2 keeps its copies of the methods of a class on the constructor, under their names.
    openNamesOfConstructor: ["toLocaleString"],
    mutability: "AlwaysLocked",
    types: [exactType(`${elementName}Array`)],
    static: { BYTES_PER_ELEMENT: bytes },
    proto: { BYTES_PER_ELEMENT: bytes },
  });
}

export interface NamespaceOptions extends EntryColumns {
  locked?: boolean;
  // The usual lock: the members it has at start-up are fixed, and an ordinary new name can be added.
  locksMembers?: boolean;
  scope?: Scope;
  isGlobalObject?: boolean;
  listsAllMembers?: boolean;
  /** Native code that was not handed the object looks up these names on it and no other, and it stores to none. */
  namesReadByNativeCode?: readonly string[];
  /** Those of them whose value native code only tests, for being true or for being callable. It neither keeps nor calls it. */
  namesOnlyInspectedByNativeCode?: readonly string[];
  table?: StaticTableRef;
}

export function namespace(
  path: BuiltinPath,
  members: Readonly<Record<string, Field>>,
  options: NamespaceOptions = {},
): Declaration[] {
  const {
    locked = false,
    locksMembers = false,
    scope = "Realm",
    isGlobalObject = false,
    listsAllMembers = false,
    namesReadByNativeCode = null,
    namesOnlyInspectedByNativeCode = [],
    table,
    ...columns
  } = options;
  assertColumns(path, columns, entryColumnKeys);
  return [
    {
      declares: "Namespace",
      path,
      scope,
      isLocked: locked,
      locksMembers,
      isGlobalObject,
      listsAllMembers,
      namesReadByNativeCode,
      namesOnlyInspectedByNativeCode,
      columns,
    },
    ...membersFrom(path, table),
    ...membersOf(path, "Function", members),
  ];
}

export const fn = (path: BuiltinPath, field: FunctionField | readonly FunctionField[]): Declaration[] => [
  memberOf(path, "Function", field),
];
// A function that the realm keeps under an enumerator of JSC::LinkTimeConstant. No path leads to it from the global object.
export const linkTimeConstantPath = (name: string): BuiltinPath => `%LinkTimeConstant:${name}%`;
export const linkTimeConstants = (
  functions: Readonly<Record<string, FunctionField | readonly FunctionField[]>>,
): Declaration[] =>
  Object.entries(functions).flatMap(([name, field]) => [
    ...fn(linkTimeConstantPath(name), field),
    ...extend(linkTimeConstantPath(name), { linkTimeConstant: name }),
  ]);
export const method = (path: BuiltinPath, field: Field): Declaration[] => [memberOf(path, "Method", field)];
export const construction = (path: BuiltinPath, field: FunctionField | readonly FunctionField[]): Declaration[] => [
  memberWith(path, "Constructor", {
    signatures: overloadsOf(field).map(overload => signatureOf(path, "Construct", overload)),
  }),
];
// What a function that is no class does under `new`, where it can be constructed.
export const constructionOfFunction = (
  path: BuiltinPath,
  field: FunctionField | readonly FunctionField[],
): Declaration[] => [
  memberWith(path, "Function", {
    signatures: overloadsOf(field).map(overload => signatureOf(path, "Construct", overload)),
  }),
];
// What a constructor does when it is called without `new`.
export const callOfConstructor = (
  path: BuiltinPath,
  field: FunctionField | readonly FunctionField[],
): Declaration[] => [
  memberWith(path, "Constructor", {
    signatures: overloadsOf(field).map(overload => signatureOf(path, "Call", overload)),
  }),
];
const static_ = (path: BuiltinPath, field: Field): Declaration[] => [memberOf(path, "Function", field)];
export { static_ as static };
export function extend(path: BuiltinPath, columns: EntryColumns): Declaration[] {
  assertColumns(path, columns, entryColumnKeys);
  return [{ declares: "Extension", path, columns }];
}
// Members of an object that locks its members which a real package replaces with no feature test that passes.
export const replacedByPackages = (...paths: readonly BuiltinPath[]): Declaration[] =>
  paths.flatMap(path => extend(path, { mutability: "ConstantUnlessWritten" }));
export const privateAlias = (...paths: readonly BuiltinPath[]): Declaration[] =>
  paths.flatMap(path => extend(path, { privateAlias: true }));

export class OptionalLayoutField {
  readonly type: TableType;
  constructor(type: TableType) {
    this.type = type;
  }
}

export const maybeAbsent = (type: TableType) => new OptionalLayoutField(type);

export function layout(
  name: LayoutName,
  fields: Readonly<Record<string, TableType | OptionalLayoutField>>,
): Declaration[] {
  const declared = Object.entries(fields).map(([field, type]): LayoutFieldDeclaration =>
    type instanceof OptionalLayoutField
      ? { name: field, isOptional: true, type: type.type.spec }
      : { name: field, isOptional: false, type: type.spec },
  );
  return [{ declares: "Layout", name, isTuple: false, fields: declared }];
}

export const tuple = (name: LayoutName, elements: readonly TableType[]): Declaration[] => [
  {
    declares: "Layout",
    name,
    isTuple: true,
    fields: elements.map(type => ({ name: null, isOptional: false, type: type.spec })),
  },
];

export const same = (path: BuiltinPath, original: BuiltinPath): Declaration[] => [
  { declares: "SameObject", path, original },
];
export const inherits = (path: BuiltinPath, prototype: BuiltinPath | null): Declaration[] => [
  { declares: "Inheritance", path, prototype },
];
export const name = (...texts: readonly string[]): Declaration[] => texts.map(text => ({ declares: "Name", text }));

export const intrinsic = (
  intrinsicName: string,
  position: IntrinsicPosition,
  meaning: IntrinsicSpec,
): Declaration[] => [{ declares: "Intrinsic", name: intrinsicName, position, isPrefixedGlobal: false, meaning }];
export const prefixedGlobal = (globalName: string, meaning: IntrinsicSpec): Declaration[] => [
  { declares: "Intrinsic", name: globalName, position: "Value", isPrefixedGlobal: true, meaning },
];
export const excluded = (file: string, ...functions: readonly string[]): Declaration[] =>
  functions.map(functionName => ({ declares: "ExcludedFunction", function: { file, name: functionName } }));
export const handwritten = (...files: readonly string[]): Declaration[] =>
  files.map(file => ({ declares: "HandwrittenFile", file }));
export const hostRoles = (...paths: readonly BuiltinPath[]): Declaration[] =>
  paths.map(path => ({ declares: "HostRole", path }));
export const hostClassRoles = (...names: readonly ClassName[]): Declaration[] =>
  names.map(className => ({ declares: "HostClassRole", name: className }));
export const unfilledHostRoles = (path: BuiltinPath, className: ClassName): Declaration[] => [
  { declares: "UnfilledHostRoles", path, class: className },
];
export const leftOut = (parts: Partial<Omit<LeftOutDeclaration, "declares">>): Declaration[] => [
  { declares: "LeftOut", schemas: [], paths: [], definedNames: [], modules: [], mayBeNamed: false, ...parts },
];
export const frontEndFunctions = (file: string, ...functions: readonly string[]): Declaration[] =>
  functions.map(functionName => ({ declares: "FrontEndFunction", function: { file, name: functionName } }));
export const engineFeatures = (...names: readonly FeatureName[]): Declaration[] => [
  { declares: "EngineFeatures", names },
];

export const hostRead = (context: HostReadContext, exportName: string, use: HostReadUse): Declaration[] => [
  { declares: "HostRead", context, exportName, use },
];

function hostValueOf(value: PlaceLike): HostValueSpec {
  const place = placeOf(value);
  assert(
    place.place === "NewValue" || place.place === "NativeCell" || place.place === "NativeMemory",
    `${place.place}: where no call of a built-in is under way, native code has what it makes, what lies in a native cell, and b.nativeMemory`,
  );
  return place;
}

export interface HostCallOptions {
  times: CallbackTimes;
  this?: PlaceLike;
  /** Without a list native code passes what the annotations of the callee's own parameters say. */
  args?: readonly PlaceLike[];
  /** What may follow the listed arguments, any number of times. */
  otherArgs?: PlaceLike;
  /** Without a list anybody may get what the call answers. b.dropped: nobody does. */
  result?: readonly HostUseSpec[];
}

// What native code does with a value that it got hold of by itself: an export that it read from a module of the library, the object of a function of the library, what a call of its own answered.
export const inspectedByHost: HostUseSpec = { read: "Inspected" };
export const dropped: readonly HostUseSpec[] = [];
// The entries and records that name the cell say what becomes of it from there.
export const keptIn = (cell: string): HostUseSpec => ({ read: "Kept", cell });
// From then on the entry holds the value: it is the function object of a function, what a property holds.
export const isValueOf = (builtin: BuiltinPath): HostUseSpec => ({ read: "IsValueOf", builtin });
export const passedTo = (builtin: BuiltinPath, argument: number): HostUseSpec => ({
  read: "PassedTo",
  builtin,
  argument,
});
export const calledByHost = (options: HostCallOptions): HostUseSpec => ({
  read: "Called",
  call: {
    times: options.times,
    thisValue: options.this === undefined ? undefined : hostValueOf(options.this),
    arguments: options.args?.map(hostValueOf),
    otherArguments: options.otherArgs === undefined ? undefined : hostValueOf(options.otherArgs),
    result: options.result,
  },
});
// Native code reads the member of the value, an element under its index, and the uses are of what it finds.
export const memberOfValue = (member: string | number, ...uses: readonly HostUseSpec[]): HostUseSpec => ({
  read: "Member",
  name: member,
  uses,
});

export const exportRead = (exportName: string, ...uses: readonly HostUseSpec[]) => ({ name: exportName, uses });
export const functionUsed = (called: FunctionRef, ...uses: readonly HostUseSpec[]) => ({ function: called, uses });

export interface HostObjectOptions {
  /** Without it the object has Object.prototype above it. */
  prototype?: BuiltinPath | null;
  /** The own properties that native code defines, each with what it puts there. */
  fields?: Readonly<Record<string, PlaceLike | readonly PlaceLike[]>>;
  /** What native code puts under every other name and index that it may define. Without it the object has the listed fields alone. */
  otherNames?: PlaceLike | readonly PlaceLike[];
  /** Of whatever is stored or defined under any key the object keeps a string, which code that the stored value names may make. */
  keepsStringsOfStoredValues?: boolean;
  /** By the index of an internal field: what native code does with what code of the library stores there. */
  internalFields?: Readonly<Record<number, readonly HostUseSpec[]>>;
}

// An object that native code makes by itself and hands to code of the library or of the program.
export const hostObject = (cell: string, options: HostObjectOptions): Declaration[] => {
  const valuesOf = (values: PlaceLike | readonly PlaceLike[]) =>
    (Array.isArray(values) ? (values as readonly PlaceLike[]) : [values as PlaceLike]).map(hostValueOf);
  return [
    {
      declares: "HostObject",
      cell,
      function: null,
      prototype: options.prototype === undefined ? "Object.prototype" : options.prototype,
      fields: [
        ...Object.entries(options.fields ?? {}).map(([field, values]) => ({ name: field, values: valuesOf(values) })),
        ...(options.otherNames === undefined ? [] : [{ name: null, values: valuesOf(options.otherNames) }]),
      ],
      internalFields: Object.entries(options.internalFields ?? {}).map(([index, uses]) => ({
        index: Number(index),
        uses,
      })),
      keepsStringsOfStoredValues: options.keepsStringsOfStoredValues ?? false,
    },
  ];
};

// A function that native code makes from a host function of its own and hands to code of the library, which has no other way to it.
export function hostFunction(
  cell: string,
  file: string,
  symbol: string,
  field: FunctionField | readonly FunctionField[],
): Declaration[] {
  return [
    {
      declares: "NativeBinding",
      kind: "NewCppFunction",
      file,
      symbol,
      hostNumber: null,
      answersFunction: true,
      isHandedByNativeCode: true,
    },
    ...static_(pathOfNativeBinding("NewCppFunction", file, symbol), field),
    {
      declares: "HostObject",
      cell,
      function: pathOfNativeFunction(file, symbol),
      prototype: "Function.prototype",
      fields: [],
      internalFields: [],
      keepsStringsOfStoredValues: false,
    },
  ];
}

// Classes of the host, declared or not, have a native method under the name (namesOfMethodsCallingLoads of b.startup), and a call of one calls what lies in the cell.
export function hostMethodCall(member: string, cell: string, options: HostCallOptions): Declaration[] {
  const use = calledByHost(options);
  assert(use.read === "Called" && use.call !== undefined);
  return [{ declares: "HostMethodCall", name: member, cell, call: use.call }];
}

// What native code passes to a member that it finds under the name on an operand and calls (b.calls).
export const namedMemberCall = (member: string, args: readonly PlaceLike[]): Declaration[] => [
  { declares: "NamedMemberCall", name: member, arguments: args.map(hostValueOf) },
];

export interface NativeCallsOptions {
  // The native functions that end in the call, as a call of one is spelled.
  through: readonly string[];
  calls: readonly (FunctionRef | { function: FunctionRef; uses: readonly HostUseSpec[] })[];
  // Where those native functions are declared and defined, where one calls another, and where what they make is there already.
  otherMentions: readonly NativeMentionSpec[];
  callers: readonly NativeCallerSpec[];
}

// Every place where native code names one of the functions is listed, and the generator counts them in the sources.
export const nativeCalls = (options: NativeCallsOptions): Declaration[] => [{ declares: "NativeCalls", ...options }];

export interface StartupOptions {
  modules?: readonly string[];
  // What native code reads from a start-up module, and what becomes of it.
  loads?: readonly ModuleLoadSpec[];
  // Native code calls these only where it hands on what it reads from the start-up modules.
  functionsCalledWithLoads?: readonly CalledFunctionSpec[];
  // Classes of the host, declared or not, have a native method under each of these names that calls what is read.
  namesOfMethodsCallingLoads?: readonly string[];
  moduleLoaderFunctions?: readonly FunctionRef[];
}

export const startup = (options: StartupOptions): Declaration[] => [
  {
    declares: "Startup",
    modules: options.modules ?? [],
    loads: options.loads ?? [],
    functionsCalledWithLoads: options.functionsCalledWithLoads ?? [],
    namesOfMethodsCallingLoads: options.namesOfMethodsCallingLoads ?? [],
    moduleLoaderFunctions: options.moduleLoaderFunctions ?? [],
  },
];

export const seenCodeOnly = (options: {
  holders?: readonly BuiltinPath[];
  nativeFiles?: readonly string[];
}): Declaration[] => [
  { declares: "SeenCodeOnly", holders: options.holders ?? [], nativeFiles: options.nativeFiles ?? [] },
];

export const declarations = (...groups: readonly (readonly Declaration[])[]) => new DeclarationFile(groups.flat());
