// The words in which a schema describes its natives to the table of built-ins, as far as the schemas use them.
import assert from "node:assert";
import type {
  BuiltinPath,
  CallbackSpec,
  ClassName,
  HandlerSpec,
  MemberPath,
  OperandName,
  PlaceSpec,
  Primitive,
  ProtocolSpec,
  SlotName,
  TypeNameSpec,
  TypeSpec,
  UseSpec,
} from "./vocabulary.ts";

export type * from "./vocabulary.ts";
export { undefined_ as undefined };

function allocated(spec: TypeSpec): TypeSpec {
  switch (spec.type) {
    case "Anything":
    case "Object":
    case "Instance":
    case "Layout":
      return { ...spec, freshness: "Yes" };
    case "Union":
      return { type: "Union", members: spec.members.map(allocated) };
    case "Primitive":
      return spec.primitive === "Symbol" ? { ...spec, freshness: "Yes" } : spec;
    case "Never":
    case "Integers":
    case "StringLiterals":
    case "Function":
    case "PlainData":
    case "Builtin":
    case "Operand":
      return spec;
  }
}

export class TableType {
  readonly spec: TypeSpec;

  constructor(spec: TypeSpec) {
    this.spec = spec;
  }

  #instance(modifier: string): Extract<TypeSpec, { type: "Instance" }> {
    assert(this.spec.type === "Instance", `${modifier} follows instance()`);
    return this.spec;
  }

  get exactly(): TableType {
    return new TableType({ ...this.#instance(".exactly"), isOfClassItself: true });
  }

  holding(contents: Readonly<Record<SlotName, TableType>>): TableType {
    const specs = Object.fromEntries(Object.entries(contents).map(([slot, type]) => [slot, type.spec]));
    return new TableType({ ...this.#instance(".holding()"), contents: specs });
  }

  get fresh(): TableType {
    return new TableType(allocated(this.spec));
  }
}

const primitive = (primitive: Primitive) => new TableType({ type: "Primitive", primitive });

export const any = new TableType({ type: "Anything" });
const undefined_ = primitive("Undefined");
export const strictNull = primitive("Null");
export const bool = primitive("Boolean");
export const f64 = primitive("Number");
export const string = primitive("String");
export const bigint = primitive("BigInt");
export const object = new TableType({ type: "Object" });
export const callable = new TableType({ type: "Function" });
export const plainData = new TableType({ type: "PlainData" });
export const i32 = new TableType({ type: "Integers", minimum: -(2 ** 31), maximum: 2 ** 31 - 1 });
export const instance = (className: ClassName) => new TableType({ type: "Instance", class: className });
export const ordinaryObjectOf = (layout: string) => new TableType({ type: "Layout", layout, isOrdinaryObject: true });
export const builtin = (path: BuiltinPath) => new TableType({ type: "Builtin", path });
export const operand = (name: OperandName) => new TableType({ type: "Operand", operand: name });
export const union = (...types: readonly [TableType, TableType, ...TableType[]]) =>
  new TableType({
    type: "Union",
    members: types.flatMap(({ spec }) => (spec.type === "Union" ? spec.members : [spec])),
  });

export type PlaceLike = TableType | PlaceSpec;

function placeOf(place: PlaceLike): PlaceSpec {
  if (!(place instanceof TableType)) return place;
  const { spec } = place;
  return spec.type === "Operand" ? { place: "Operand", operand: spec.operand } : { place: "NewValue", value: spec };
}

export const thrown: PlaceSpec = { place: "NewValue", value: any.spec, holdsWhatIsThrown: true };
export const nativeMemory: PlaceSpec = { place: "NativeMemory" };
export const nativeCell = (cell: string): PlaceSpec => ({ place: "NativeCell", cell });

export const inspected: readonly UseSpec[] = [];
export const everything: UseSpec = { use: "Everything" };
export const retained: UseSpec = { use: "Retains", in: nativeMemory };
export const retainedByNativeCode: readonly UseSpec[] = [retained];
export const returned: UseSpec = { use: "Returns" };
export const membersOnlyInspected: UseSpec = { use: "Role", role: "MembersAreOnlyInspected" };
export const storedIn = (place: PlaceLike): UseSpec => ({ use: "Retains", in: placeOf(place) });
export const readsContents = (): UseSpec => ({ use: "ReadsContents" });
export const writesContents = (): UseSpec => ({ use: "WritesContents" });
export const reachableValuesStoredIn = (place: PlaceLike): UseSpec => ({
  use: "RetainsContents",
  in: placeOf(place),
  transitively: true,
});
export const definesName = (names: readonly string[], value: PlaceLike): UseSpec => ({
  use: "DefinesName",
  key: { key: "Names", names },
  value: placeOf(value),
});
export const memberStoredIn = (path: MemberPath, place: PlaceLike): UseSpec => ({
  use: "RetainsMember",
  path,
  in: placeOf(place),
});
export const createdIn = (value: TableType, place: PlaceLike): UseSpec => ({
  use: "Creates",
  value: value.spec,
  in: placeOf(place),
});

export const named = (...names: readonly string[]): ProtocolSpec => ({ named: names });
export const runs = (...protocols: readonly ProtocolSpec[]): UseSpec => ({ use: "Runs", protocols });
export const runsTransitively = (...protocols: readonly ProtocolSpec[]): UseSpec => ({
  use: "Runs",
  protocols,
  on: "ReachableObjects",
});
export const optionBag = (names: readonly string[]): UseSpec[] => [runsTransitively("ToPrimitive", named(...names))];
export const printedByFormatter = (...otherMembers: readonly string[]): UseSpec =>
  runsTransitively(
    "OwnKeys",
    "OwnValues",
    "PrototypeChain",
    "Iterate",
    "ToPrimitive",
    { calls: ["@@@nodejs.util.inspect.custom", "toISOString", "toJSON"] },
    named(
      ...otherMembers,
      "@@toStringTag",
      "atime",
      "birthtime",
      "cause",
      "children",
      "ctime",
      "data",
      "error",
      "errors",
      "key",
      "length",
      "line",
      "message",
      "mtime",
      "name",
      "originalLine",
      "props",
      "size",
      "sourceURL",
      "stack",
      "type",
    ),
  );

interface HandlerOptions extends Pick<HandlerSpec, "times" | "result"> {
  this: PlaceLike;
  args: readonly PlaceLike[];
}

interface CallbackOptions extends HandlerOptions, Pick<CallbackSpec, "afterwards"> {
  spreadArgs?: PlaceLike;
}

const passed = (options: HandlerOptions) => ({
  thisValue: options.this === undefined_ ? undefined : placeOf(options.this),
  arguments: options.args.map(placeOf),
});

export const called = (options: CallbackOptions): UseSpec => ({
  use: "Calls",
  times: options.times,
  afterwards: options.afterwards,
  ...passed(options),
  spreadArguments: options.spreadArgs && placeOf(options.spreadArgs),
  result: options.result,
});
export const memberCalled = (path: MemberPath, options: HandlerOptions): UseSpec => ({
  use: "CallsMember",
  path,
  times: options.times,
  ...passed(options),
  result: options.result,
});

export const exactType = (path: string): TypeNameSpec => ({ path: path.split("."), isView: false, typeArguments: [] });
export const viewType = (path: string): TypeNameSpec => ({ path: path.split("."), isView: true, typeArguments: [] });
