// The type model behind `bindgen-lib.ts`.

import assert from "node:assert";
import util from "node:util";
import type {
  ClassColumns,
  Conversion,
  DirectForm,
  EntryColumns,
  ParameterType,
  Primitive,
  SignatureColumns,
  TypeSpec,
} from "./builtins/vocabulary.ts";
import { parseDeclaredAlternative, type DeclaredAlternative } from "./declared-type-checks.ts";

export interface Layout {
  size: number;
  align: number;
}

/** Where a named type or function was declared. */
export interface Origin {
  /** `node_os` for `node_os.bind.ts`. */
  stem: string;
  /** `NodeOs`: the C++ namespace of the file's functions, and `Generated<namespace>.h`. */
  namespace: string;
  /** Rust module the file's items are generated into. */
  rustModule: string;
  /** Cargo package that owns the file. */
  crate: string;
}

/** Where Rust code is being emitted, so paths to named types can be spelled from there. */
export type RustScope = Pick<Origin, "crate" | "rustModule">;

const roundUp = (n: number, align: number) => Math.ceil(n / align) * align;

function structLayout(fields: readonly Layout[]): Layout {
  let size = 0;
  let align = 1;
  for (const field of fields) {
    size = roundUp(size, field.align) + field.size;
    align = Math.max(align, field.align);
  }
  return { size: roundUp(size, align), align };
}

/** `{ union data; uint8_t tag; }`. */
function taggedUnionLayout(alternatives: readonly Layout[]): Layout {
  const align = Math.max(...alternatives.map(a => a.align));
  const union = { size: roundUp(Math.max(...alternatives.map(a => a.size)), align), align };
  return structLayout([union, { size: 1, align: 1 }]);
}

export function snakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase();
}

export function pascalCase(name: string): string {
  return name
    .split(/[^A-Za-z0-9]+/)
    .filter(part => part.length > 0)
    .map(part => part[0].toUpperCase() + part.slice(1))
    .join("");
}

const rustKeywords = new Set(
  "as break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while async await dyn gen abstract become box do final macro override priv try typeof unsized virtual yield".split(
    " ",
  ),
);
export function rustIdent(name: string): string {
  assert(!/^(self|Self|super|crate)$/.test(name), `${name} cannot name anything in Rust, even as r#${name}`);
  return rustKeywords.has(name) ? `r#${name}` : name;
}

/** C++ has no way to spell one as a name. */
const cppKeywords = new Set(
  "alignas alignof and and_eq asm auto bitand bitor bool break case catch char char8_t char16_t char32_t class compl concept const consteval constexpr constinit const_cast continue co_await co_return co_yield decltype default delete do double dynamic_cast else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept not not_eq nullptr operator or or_eq private protected public register reinterpret_cast requires return short signed sizeof static static_assert static_cast struct switch template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while xor xor_eq".split(
    " ",
  ),
);

export function assertDistinct(names: readonly string[], what: string): void {
  const repeated = names.find((name, i) => names.indexOf(name) !== i);
  assert(repeated === undefined, `two ${what} are both ${repeated}`);
}

export function asciiLiteral(value: string): string {
  assert(!/[^\x20-\x7e]/.test(value), `must be printable ASCII: ${util.inspect(value)}`);
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"_s`;
}

/** JavaScript values, divided by what tells them apart. A value of none of these kinds is "other". See "Unions and kinds" in the docs. */
export type ValueKind =
  | "undefined"
  | "null"
  | "boolean"
  | "number"
  | "bigint"
  | "string"
  | "stringObject"
  | "array"
  | "arrayBuffer"
  | "arrayBufferView"
  | "callable"
  | "iterable"
  | "object"
  | JSClass;

/** The instances of a C++ `JSCell` class. */
export interface JSClass {
  readonly cpp: string;
  /** Its instances are instances of this one too. */
  readonly base?: JSClass;
}

type ValueKinds = readonly ValueKind[] | "any";

const dateInstance: JSClass = { cpp: "JSC::DateInstance" };

/** How C++ tells that a value is of a kind: `ofValue` if it is not a cell, `ofCell` of `cell`, by its type byte. */
export const kindTests: Record<
  Exclude<ValueKind, JSClass>,
  { ofValue?: (value: string) => string; ofCell?: string }
> = {
  undefined: { ofValue: value => `${value}.isUndefined()` },
  null: { ofValue: value => `${value}.isNull()` },
  boolean: { ofValue: value => `${value}.isBoolean()` },
  number: { ofValue: value => `${value}.isNumber()` },
  bigint: { ofCell: "cell->isHeapBigInt()" },
  string: { ofCell: "cell->isString()" },
  stringObject: { ofCell: "cell->inherits<JSC::StringObject>()" },
  array: { ofCell: "cell->inherits<JSC::JSArray>()" },
  arrayBuffer: { ofCell: "cell->inherits<JSC::JSArrayBuffer>()" },
  arrayBufferView: { ofCell: "cell->inherits<JSC::JSArrayBufferView>()" },
  callable: { ofCell: "cell->isCallable()" },
  // Only for the overloads of a member of an interface, after every other test. The first can throw.
  iterable: { ofCell: "Bun::Bindgen::iteratorMethodOf(*globalObject, cell)" },
  object: { ofCell: "cell->isObject()" },
};

const primitiveKinds: readonly (ValueKind | "other")[] = ["undefined", "null", "boolean", "number", "bigint", "string"];
/** What a type that takes every object `refuses`. */
const nonObjects = "what is not an object";
export const refusesNonObjects = (type: Type) => type.refuses === nonObjects;

const takes = (type: Type, kind: ValueKind | "other") =>
  type.valueKinds === "any" || (kind !== "other" && type.valueKinds.includes(kind));

function distinguishingKinds(types: readonly Type[]): (ValueKind | "other")[] {
  const kinds = types
    .flatMap(type => (type.valueKinds === "any" ? [] : type.valueKinds))
    .filter((kind, index, kinds) => kinds.indexOf(kind) === index);
  for (const kind of kinds)
    for (let base = typeof kind === "object" ? kind.base : undefined; base; base = base.base)
      assert(
        !kinds.includes(base),
        "a class and one it extends are told apart here, but an instance is both: take the base",
      );
  return [...kinds, "other"];
}

/** Which of `alternatives` get a value of each kind, in order: all but the last refuse some. Equal lists are one array. */
function alternativesByKind(alternatives: readonly Type[]): Map<ValueKind | "other", readonly number[]> {
  const lists = new Map<string, readonly number[]>();
  return new Map(
    distinguishingKinds(alternatives).map(kind => {
      const list: number[] = [];
      for (const [i, type] of alternatives.entries()) {
        // What one refused, another that refuses the same would too.
        if (!takes(type, kind) || list.some(earlier => alternatives[earlier].refuses === type.refuses)) continue;
        list.push(i);
        if (!type.refuses) break;
        if (refusesNonObjects(type) && kind !== "other" && !primitiveKinds.includes(kind)) break;
      }
      // A primitive skips an alternative that takes only objects, unless it is the last: that one reports it.
      if (primitiveKinds.includes(kind)) {
        for (let i = list.length - 2; i >= 0; i--) if (refusesNonObjects(alternatives[list[i]])) list.splice(i, 1);
      }
      if (!lists.has(`${list}`)) lists.set(`${list}`, list);
      return [kind, lists.get(`${list}`)!];
    }),
  );
}

/** https://webidl.spec.whatwg.org/#js-union */
function webAlternativesByKind(alternatives: readonly Type[]): Map<ValueKind | "other", readonly number[]> {
  const first = (...categories: UnionCategory[]) =>
    categories.map(category => alternatives.findIndex(type => type.unionCategory === category)).filter(i => i >= 0);
  const ofKind = (kind: ValueKind) => {
    const index = alternatives.findIndex(type => type.unionCategory === "kind" && takes(type, kind));
    return index < 0 ? [] : [index];
  };
  const fallback = first("string", "number", "boolean").slice(0, 1);
  const forObjects = first("sequence", "dictionary", "object");
  const absent = (kind: "undefined" | "null", other: "undefined" | "null") => [
    ...ofKind(kind),
    ...(kind === "undefined" ? ofKind(other) : []),
    ...first("dictionary").filter(i => alternatives[i] instanceof DictionaryType),
  ];
  const kinds = distinguishingKinds(alternatives.filter(type => type.unionCategory === "kind"));
  const lists = new Map<string, readonly number[]>();
  const entries: [ValueKind | "other", number[]][] = [
    ["undefined", [...absent("undefined", "null"), ...fallback].slice(0, 1)],
    ["null", [...absent("null", "undefined"), ...fallback].slice(0, 1)],
    ["boolean", first("boolean").concat(fallback).slice(0, 1)],
    ["number", first("number").concat(fallback).slice(0, 1)],
    ["string", fallback],
    ...kinds.flatMap((kind): [ValueKind, number[]][] =>
      kind === "other" || kind === "undefined" || kind === "null" ? [] : [[kind, ofKind(kind)]],
    ),
    ["other", [...forObjects, ...fallback]],
  ];
  return new Map(entries.map(([kind, list]) => [kind, lists.getOrInsert(`${list}`, list)]));
}

export function indent(text: string, by: number): string {
  const pad = " ".repeat(by);
  return text
    .split("\n")
    .map(line => (line.length > 0 ? pad + line : line))
    .join("\n");
}

/** C++ that returns `failure` if `succeeded` is false, null or empty, which is how a call says that it threw. */
export const cppReturnIfFailed = (succeeded: string, failure: string) =>
  `if (Bun::Bindgen::hasException(scope, ${succeeded})) [[unlikely]]\n    return ${failure};`;

/** While the glue of what `isCold` is written: the C++ call that converts, false if it threw. */
export const outOfLine: { convert?: (type: Type, target: string, value: string, ctx: string) => string } = {};

const cppConvertBytes = (type: Type, target: string, value: string, ctx: string, expected: string) =>
  outOfLine.convert
    ? `Bun::Bindgen::convertBytesOutOfLine<${type.idlType}>(globalObject, ${value}, ${ctx}, ${target}, ${asciiLiteral(expected).slice(0, -2)})`
    : `WebCore::Converter<${type.idlType}>::convertInto(*globalObject, ${value}, ${ctx}, ${target}, ${asciiLiteral(expected)})`;

/** C++ statements that engage `optional`, a `std::optional`, then fill what it holds: `fill` is given a name for that. */
export function cppEmplace(optional: string, fill: (target: string) => string): string {
  const [first, ...rest] = optional.split(/\W+/);
  const target = `${first}${rest.map(part => part[0].toUpperCase() + part.slice(1)).join("")}Value`;
  return `auto& ${target} = ${optional}.emplace();\n${fill(target)}`;
}

// ───────────────────────────── the words of the table of built-ins ─────────────────────────────

const neverType: TypeSpec = { type: "Never" };
const primitiveType = (primitive: Primitive): TypeSpec => ({ type: "Primitive", primitive });
const instanceType = (className: string): TypeSpec => ({ type: "Instance", class: className });
const membersOf = (type: TypeSpec): readonly TypeSpec[] => (type.type === "Union" ? type.members : [type]);

function unionType(...types: readonly TypeSpec[]): TypeSpec {
  const members = types.flatMap(membersOf).filter(member => member.type !== "Never");
  return members.length === 0 ? neverType : members.length === 1 ? members[0] : { type: "Union", members };
}

/** `type` less the primitives that `removed` has. */
function withoutPrimitives(type: TypeSpec, removed: TypeSpec): TypeSpec {
  const primitives = membersOf(removed).flatMap(member => (member.type === "Primitive" ? [member.primitive] : []));
  const isRemoved = (member: TypeSpec) => member.type === "Primitive" && primitives.includes(member.primitive);
  return unionType(...membersOf(type).filter(member => !isRemoved(member)));
}

const undefinedType = primitiveType("Undefined");
const nullishType = unionType(undefinedType, primitiveType("Null"));
const numberType = primitiveType("Number");
const bigIntType = primitiveType("BigInt");
const stringType = primitiveType("String");
const anyPrimitiveType = unionType(
  nullishType,
  primitiveType("Boolean"),
  numberType,
  stringType,
  primitiveType("Symbol"),
  bigIntType,
);
/** A `String` object is among what a strict type takes: as a conversion, `ToString` would be for every value. */
const stringOrStringObjectType = unionType(stringType, instanceType("String"));

/** A number says no more than the safe integers exactly. */
const integersType = (min: number | bigint, max: number | bigint): TypeSpec => ({
  type: "Integers",
  minimum: Math.max(Number(min), Number.MIN_SAFE_INTEGER),
  maximum: Math.min(Number(max), Number.MAX_SAFE_INTEGER),
});

/** A view of a shared buffer is an instance like any other: `refuses` is about those. */
const bufferTypes = (allowShared: boolean) =>
  unionType(
    instanceType("ArrayBuffer"),
    ...(allowShared ? [instanceType("SharedArrayBuffer")] : []),
    instanceType("TypedArray"),
    instanceType("DataView"),
  );

const strictType = (accepted: TypeSpec): ParameterType => ({
  accepted,
  conversion: "None",
  converted: accepted,
  refused: neverType,
  mode: "Required",
  members: [],
});
/** `converted` is what the call gets: a value of `accepted` as it is, or what `conversion` gives for any other. */
const convertingType = (accepted: TypeSpec, conversion: Conversion, converted = accepted): ParameterType => ({
  ...strictType(accepted),
  conversion,
  converted,
});

function stringParameterType(valueKinds: ValueKinds): ParameterType {
  if (valueKinds === "any") return convertingType(stringType, "ToString");
  return strictType(valueKinds.includes("stringObject") ? stringOrStringObjectType : stringType);
}

const nullToEmptyParameterType = convertingType(unionType(stringType, primitiveType("Null")), "ToString");

/** `type` for an argument that a value of `absent` leaves out. The call gets that value as it is. */
const optionalParameterType = (type: ParameterType, absent: TypeSpec): ParameterType => ({
  ...type,
  accepted: unionType(type.accepted, absent),
  converted: unionType(type.converted, absent),
  refused: withoutPrimitives(type.refused, absent),
  mode: "Optional",
});

/** `type` for an argument that every value it does not take leaves out. The members of an object are still read. */
function ignoringParameterType(type: ParameterType): ParameterType {
  const readsMembers = type.conversion === "Dictionary";
  const accepted: TypeSpec = readsMembers ? unionType(type.accepted, anyPrimitiveType) : { type: "Anything" };
  const converted: TypeSpec = readsMembers ? unionType(accepted, { type: "Object" }) : accepted;
  return { ...type, accepted, converted, refused: neverType, mode: "Optional" };
}

const primitiveOfKind = new Map<ValueKind | "other", Primitive>([
  ["undefined", "Undefined"],
  ["null", "Null"],
  ["boolean", "Boolean"],
  ["number", "Number"],
  ["bigint", "BigInt"],
  ["string", "String"],
]);

/** A value of the type is made without the heap. */
function holdsNoCell(type: TypeSpec): boolean {
  const isImmediate = (member: TypeSpec) =>
    member.type === "Integers" ||
    (member.type === "Primitive" && ["Undefined", "Null", "Boolean", "Number"].includes(member.primitive));
  return membersOf(type).every(isImmediate);
}

/** One of what `b.any.returning` lists: a word of `parseDeclaredAlternative`, or a type of the table as it is. */
export type DeclaredResult = string | TypeSpec;

const typesOfDeclaredWords: Readonly<Record<Exclude<DeclaredAlternative, { instance: string }>, TypeSpec>> = {
  string: stringType,
  number: numberType,
  int32: integersType(-(2 ** 31), 2 ** 31 - 1),
  bigint: bigIntType,
  boolean: primitiveType("Boolean"),
  undefined: undefinedType,
  null: primitiveType("Null"),
  object: { type: "Object" },
  Promise: instanceType("Promise"),
  this: { type: "Operand", operand: "this" },
};

function typeOfDeclaredResult(declared: DeclaredResult): TypeSpec {
  if (typeof declared !== "string") return declared;
  const alternative = parseDeclaredAlternative(declared);
  return typeof alternative === "object" ? instanceType(alternative.instance) : typesOfDeclaredWords[alternative];
}

/** What `options` says to the table of built-ins: every key but bindgen's `own`. */
function columnsOf<Options extends object, Key extends keyof Options>(
  options: Options,
  own: readonly Key[],
): Omit<Options, Key> {
  const isOwn = (key: string) => (own as readonly string[]).includes(key);
  return Object.fromEntries(Object.entries(options).filter(([key]) => !isOwn(key))) as Omit<Options, Key>;
}

type UnionCategory = "kind" | "boolean" | "number" | "string" | "sequence" | "dictionary" | "object";

export abstract class Type {
  /** `undefined` means absent. */
  get optional(): OptionalType {
    return new OptionalType(this, "optional");
  }
  /** `null` or `undefined` means absent. */
  get nullable(): OptionalType {
    return new OptionalType(this, "nullable");
  }
  /** Every falsy value means absent. */
  get falsyAsNull(): OptionalType {
    return new OptionalType(this, "falsyAsNull");
  }
  /** `undefined`, `null` or `""` means absent, as for `JSValue::get_truthy`. */
  get emptyStringAsNull(): OptionalType {
    return new OptionalType(this, "emptyStringAsNull");
  }
  /** Every value of a kind it does not take, or that it refuses, means absent. */
  get otherAsNull(): OptionalType {
    return new OptionalType(this, "otherAsNull");
  }
  /** Absent only if the call has no such argument: `undefined` is converted like any other value. Only for an argument. */
  get ifPassed(): OptionalType {
    return new OptionalType(this, "ifPassed");
  }
  /** Also the argument itself: `(T, JsLocal<'a>)`. Only for an argument. */
  get withValue(): WithValueType {
    return new WithValueType(this);
  }
  /** Value to use when absent. Only for arguments and dictionary members. */
  default(value: unknown): DefaultType {
    return new DefaultType(this, value);
  }

  /** The C++ tag type whose `WebCore::Converter` turns a JSValue into a C++ value. */
  abstract readonly idlType: string;
  /** TypeScript spelling of the values it takes: `any` where the conversion coerces. */
  abstract readonly tsType: string;
  /** What it takes as an argument and what becomes of that, in the words of src/codegen/builtins/vocabulary.ts. */
  abstract get parameterType(): ParameterType;
  /** What it is as a result, in the same words. */
  get resultType(): TypeSpec {
    return this.parameterType.accepted;
  }
  /** The values that converting neither changes nor refuses, and how a caller that has one passes it to the Rust function's thunk itself: `cppType` is what `ExternOf<idlType>` is. null: only the host function makes what the thunk takes. */
  get directForm(): DirectForm | null {
    return null;
  }
  /** Nothing allocates for a value of `directForm.type` or writes to it, unless the body has a capability: a rope stays a rope. */
  get isReadInPlace(): boolean {
    return false;
  }
  /** Converting can throw for a value `parameterType` takes, or for what its conversion gives: a view of a shared buffer, a fraction after `ToNumber`. */
  get canRefuse(): boolean {
    return this.refuses !== null || this.dependencies.some(type => type.canRefuse);
  }

  /** How `IDLNullable<this>::ImplementationType` says "null". */
  get nullRepresentation(): "optional" | "pointer" | "emptyValue" {
    return this.returnsValueUnchanged ? "emptyValue" : "optional";
  }
  /** Converting `undefined` succeeds, so a dictionary member of this type is not required. */
  get takesUndefined(): boolean {
    return false;
  }
  /** The kinds of value it takes where there is a choice. "any": its own conversion decides, by coercing or by throwing. */
  get valueKinds(): ValueKinds {
    return "any";
  }
  /** The values of its kinds that it does not take, if any. In a union the next alternative gets those. */
  get refuses(): string | null {
    return null;
  }
  /** What to write in place of `.otherAsNull` on a type that throws for some values of a kind it takes, like `1.5` or an unknown string. Else null. */
  get insteadOfOtherAsNull(): string | null {
    return null;
  }
  /** A C++ condition that is true of the values `.otherAsNull` converts in place. */
  cppTakes(value: string): string {
    if (refusesNonObjects(this)) return `${value}.isObject()`;
    const kinds = this.valueKinds;
    assert(kinds !== "any");
    const ofValue = kinds.flatMap(kind => (typeof kind === "object" ? [] : (kindTests[kind].ofValue?.(value) ?? [])));
    const ofCell = kinds
      .flatMap(kind => (typeof kind === "object" ? `cell->inherits<${kind.cpp}>()` : (kindTests[kind].ofCell ?? [])))
      .map(test => test.replace("cell", `${value}.asCell()`));
    return [...ofValue, ...(ofCell.length > 0 ? [`(${value}.isCell() && (${ofCell.join(" || ")}))`] : [])].join(" || ");
  }
  /** Written `.optional`, `.nullable`, `.falsyAsNull`, `.emptyStringAsNull`, `.otherAsNull`, `.ifPassed` or `.default()`. `length` leaves out a trailing run of these. */
  get isOptional(): boolean {
    return false;
  }
  /** WebIDL's `optional`: a call to a member of an interface may leave it out. A nullable argument is still required. */
  get isOmittable(): boolean {
    return this.isOptional;
  }
  /** The host function passes the argument itself along: `ExternWithValue`. Only for an argument. */
  get passesValue(): boolean {
    return false;
  }
  /** The error for using it anywhere but as an argument, or null. */
  get refusalOutsideArgument(): string | null {
    return this.passesValue ? "b.bytes and .withValue are only for an argument" : null;
  }
  /** As an argument it stays in the frame of the thunk, and the body borrows it: `&T`. */
  get borrowedByBody(): boolean {
    return false;
  }
  /** What the thunk passes to the body for the argument it holds as `name`. */
  rustArgument(name: string): string {
    if (this.bodyMayBorrow) return `bindgen::Pass::pass(&mut Some(${name}))`;
    return this.borrowedByBody ? `&${name}` : name;
  }
  /** The body takes it over or borrows it, as its signature says. */
  get bodyMayBorrow(): boolean {
    return false;
  }
  /** `rustFromExtern` is a `bindgen::Result`. Only for an argument. */
  get rustFromExternThrows(): boolean {
    return false;
  }
  /** Converting can throw. */
  get conversionThrows(): boolean {
    return true;
  }
  /** Its `tryConvert` can throw: it does more than test the value. */
  get tryConvertThrows(): boolean {
    return this.conversionThrows && !this.returnsValueUnchanged;
  }
  /** Holds a JS value: the Rust type is branded with the call. */
  get holdsJSValue(): boolean {
    return this.dependencies.some(type => type.holdsJSValue);
  }
  /** The value that is made of it is an object without a prototype, or holds one. */
  get makesObjectWithoutPrototype(): boolean {
    return this.dependencies.some(type => type.makesObjectWithoutPrototype);
  }
  /** The conversion returns the value unchanged, so Rust holds the value itself. */
  get returnsValueUnchanged(): boolean {
    return false;
  }
  /** Points into memory JavaScript can detach, resize or free: not for a function that can run it, and only for an argument, read once all are converted. */
  get borrowsHeap(): boolean {
    return this.dependencies.some(type => type.borrowsHeap);
  }
  /** Points at what a cell owns without holding the cell: only for an argument, whose slot in the frame holds it. */
  get borrowsCell(): boolean {
    return this.dependencies.some(type => type.borrowsCell);
  }
  /** Points into the C++ host function's frame: only usable for the duration of a host call. */
  get borrowsFrame(): boolean {
    return this.dependencies.some(type => type.borrowsFrame);
  }
  /**
   * For what converts to something a JS value can stand for, which is how a `bindgen::JsList` holds its elements: a Rust
   * condition that tells such a value from those of a union's other alternatives, or "" if any object may be one.
   */
  get elementTest(): ((value: string, scope: RustScope) => string) | null {
    return null;
  }
  /** Which step of WebIDL's conversion to a union picks it. "kind": the one for its `valueKinds`. */
  get unionCategory(): UnionCategory {
    return "kind";
  }
  /** `toRust` can write a default. */
  get hasRustDefault(): boolean {
    return true;
  }
  /** `rustType` is `Copy`. */
  get rustIsCopy(): boolean {
    return this.dependencies.every(type => type.rustIsCopy);
  }
  get needsLifetime(): boolean {
    return this.holdsJSValue || this.borrowsFrame || this.borrowsHeap;
  }
  get dependencies(): readonly Type[] {
    return [];
  }
  getHeaders(out: Set<string>): void {
    for (const type of this.dependencies) type.getHeaders(out);
  }

  /** A C++ expression of `idlType::ImplementationType` for a default value written in the schema. */
  toCpp(value: unknown): string {
    throw new TypeError(`${this.tsType} cannot have a default`);
  }
  /** C++ statements that give that value to `target`, which names an object that was just default-constructed. */
  cppAssign(target: string, value: unknown): string {
    return `${target} = ${this.toCpp(value)};`;
  }
  /** The same value as a Rust expression of `rustType`. */
  toRust(value: unknown, scope: RustScope): string {
    throw new TypeError(`${this.tsType} cannot have a default`);
  }
  /** A C++ expression that converts `value`, for a type whose conversion cannot throw. `ctx` is a conversion context. */
  cppConvert(value: string, ctx: string): string {
    return `Bun::convertIDL<${this.idlType}>(*globalObject, ${value}, ${ctx})`;
  }
  /** A C++ expression for what is converted in place of the argument `value`. Those of all arguments are evaluated first, in the order of the arguments. */
  cppPrepare(value: string): string | null {
    return null;
  }
  /** C++ lines for once every argument is converted. They read into `target`, converted from `value`, what converting a later argument could have changed. */
  cppReadLast(target: string, value: string): string[] {
    return [];
  }
  /** Large, or holds something large: built where it ends up, not returned and moved there. */
  get convertsInPlace(): boolean {
    return false;
  }
  /** C++ statements that convert `value` into `target`, just default-constructed, and return `failure` if that throws. */
  cppConvertInto(target: string, value: string, ctx: string, name: string, failure: string): string {
    if (!this.conversionThrows) return `${target} = ${this.cppConvert(value, ctx)};`;
    return cppReturnIfFailed(
      outOfLine.convert?.(this, target, value, ctx) ??
        `Bun::convertIDLInto<${this.idlType}>(*globalObject, ${value}, ${ctx}, ${target})`,
      failure,
    );
  }

  abstract layout(): Layout;
  /** The Rust mirror of what `Bun::Bindgen::ExternTraits` lowers the C++ value to. */
  abstract rustExternType(scope: RustScope): string;
  /** What a Rust body sees. */
  abstract rustType(scope: RustScope): string;
  /** A Rust expression (inside `unsafe`) that consumes `expr`, a `rustExternType`. What has a lifetime takes it from `heap`, in scope there. */
  rustFromExtern(expr: string, scope: RustScope): string {
    return expr;
  }

  /** The type of a member of a returned dictionary, and of an alternative of a returned union. */
  rustResultFieldType(scope: RustScope): string {
    return this.rustType(scope);
  }
  /** A Rust expression of type `bindgen::Result<'a, bindgen::JsLocal<'a>>` that consumes `value`; `heap` is in scope. */
  rustToJS(value: string, scope: RustScope): string {
    throw new TypeError(`${this.tsType} cannot be returned to JavaScript`);
  }
  /** The same for `value`, a `Vec` of it, where one call makes the whole array. */
  rustArrayToJS(value: string): string | null {
    return null;
  }
}

// ───────────────────────────── primitives ─────────────────────────────

export abstract class PrimitiveType extends Type {
  readonly idlType: string;
  readonly tsType: string;
  readonly rustName: string;
  readonly size: number;
  readonly #valueKinds: ValueKinds;
  constructor(idlType: string, tsType: string, rustName: string, size: number, valueKinds: ValueKinds) {
    super();
    this.idlType = idlType;
    this.tsType = tsType;
    this.rustName = rustName;
    this.size = size;
    this.#valueKinds = valueKinds;
  }
  get valueKinds(): ValueKinds {
    return this.#valueKinds;
  }
  protected get cppName(): string {
    return "double";
  }
  get cppType(): string {
    return this.rustName === "bool" ? "bool" : this.cppName;
  }
  toCpp(value: unknown): string {
    if (this.rustName === "bool") {
      assert(typeof value === "boolean", `${util.inspect(value)} is not a boolean`);
      return String(value);
    }
    assert(typeof value === "number", `${util.inspect(value)} is not a number`);
    assert(Number.isFinite(value), `${value} is not finite`);
    if (!this.rustName.startsWith("f")) assert(Number.isSafeInteger(value), `${value} is not an integer`);
    return `${this.cppName} { ${value} }`;
  }
  toRust(value: unknown): string {
    return this.rustName.startsWith("f") ? `${value}_${this.rustName}` : String(value);
  }
  layout(): Layout {
    return { size: this.size, align: this.size };
  }
  rustExternType(): string {
    return this.rustName;
  }
  rustType(): string {
    return this.rustName;
  }
  rustToJS(value: string): string {
    return `bindgen::to_js::${this.rustName}(heap, ${value})`;
  }
}

export class BoolType extends PrimitiveType {
  constructor(idlType = "Bun::Bindgen::IDLStrictBoolean", valueKinds: ValueKinds = ["boolean"]) {
    super(idlType, valueKinds === "any" ? "any" : "boolean", "bool", 1, valueKinds);
  }
  /** `ToBoolean`: any value is accepted. */
  get loose(): BoolType {
    return new BoolType("WebCore::IDLBoolean", "any");
  }
  get conversionThrows(): boolean {
    return this.valueKinds !== "any";
  }
  get parameterType(): ParameterType {
    const accepted = primitiveType("Boolean");
    return this.valueKinds === "any" ? convertingType(accepted, "ToBoolean") : strictType(accepted);
  }
  get directForm(): DirectForm {
    return { value: "Boolean", cppType: "bool", type: primitiveType("Boolean") };
  }
  get tryConvertThrows(): boolean {
    return false;
  }
  get elementTest() {
    return (value: string) => `${value}.is_boolean()`;
  }
  get unionCategory(): UnionCategory {
    return "boolean";
  }
}

interface IntegerInfo {
  rust: string;
  cpp: string;
  size: number;
  /** The WebIDL integer type of this width. */
  webidl: string;
  min: number | bigint;
  max: number | bigint;
}

export class IntegerType extends PrimitiveType {
  readonly info: IntegerInfo;
  readonly #conversion: "Strict" | "Loose" | `${string}::${string}`;
  readonly #allowBigInt: boolean;
  /** `conversion` is one of the two that can take a BigInt, or the IDL type of another. */
  constructor(
    info: IntegerInfo,
    conversion: "Strict" | "Loose" | `${string}::${string}` = "Strict",
    allowBigInt = false,
    tsType = conversion !== "Strict" ? "any" : allowBigInt ? "number | bigint" : "number",
  ) {
    super(
      conversion === "Strict" || conversion === "Loose"
        ? `Bun::Bindgen::IDL${conversion}Integer<${info.cpp}${allowBigInt ? ", Bun::Bindgen::AllowBigInt::Yes" : ""}>`
        : conversion,
      tsType,
      info.rust,
      info.size,
      conversion !== "Strict" ? "any" : allowBigInt ? ["number", "bigint"] : ["number"],
    );
    this.info = info;
    this.#conversion = conversion;
    this.#allowBigInt = allowBigInt;
  }
  protected get cppName(): string {
    return this.info.cpp;
  }
  /** What a default has to be within. */
  protected get range(): readonly [min: number | bigint, max: number | bigint] {
    return [this.info.min, this.info.max];
  }
  toCpp(value: unknown): string {
    const [min, max] = this.range;
    assert(typeof value !== "number" || (value >= min && value <= max), `${value} is not in [${min}, ${max}]`);
    return super.toCpp(value);
  }
  get parameterType(): ParameterType {
    const integers = integersType(...this.range);
    const accepted = this.#allowBigInt ? unionType(integers, bigIntType) : integers;
    if (this.#conversion === "Strict") return strictType(accepted);
    if (this.#allowBigInt) return convertingType(accepted, "ToNumeric", unionType(numberType, bigIntType));
    if (this.#conversion === "Loose" || this.info.size !== 4 || this.#conversion.includes("Clamp"))
      return convertingType(accepted, "ToNumber", numberType);
    return convertingType(accepted, this.info.min < 0 ? "ToInt32" : "ToUint32");
  }
  /** A caller proves of an integer that it is an int32 and no more. */
  get directForm(): DirectForm | null {
    const [min, max] = this.range;
    if (this.info.cpp !== "int32_t" || min !== this.info.min || max !== this.info.max) return null;
    return { value: "Int32", cppType: this.info.cpp, type: integersType(min, max) };
  }
  /** A `u64` can be more than the safe integers. */
  get resultType(): TypeSpec {
    return this.info.size > 4 ? numberType : integersType(this.info.min, this.info.max);
  }
  /** A BigInt out of range, and what `ToNumber` gives that the strict conversion does not take. `.wrap` takes every number. */
  get canRefuse(): boolean {
    return this.#allowBigInt || this.#conversion === "Loose";
  }
  get insteadOfOtherAsNull(): string {
    return "b.f64.otherAsNull takes every number";
  }
  /** Also a BigInt that is in range, for an argument whose type is `number | bigint`. */
  get allowBigInt(): IntegerType {
    assert(
      this.#conversion === "Strict" || this.#conversion === "Loose",
      ".allowBigInt is for the strict and the .loose conversion; the others are ToNumber, which refuses a BigInt",
    );
    return new IntegerType(this.info, this.#conversion, true);
  }
  /** `ToNumber` first, or `ToNumeric` with `.allowBigInt`, then as strict as the default. */
  get loose(): IntegerType {
    return new IntegerType(this.info, "Loose", this.#allowBigInt);
  }
  /** WebIDL conversion: `ToNumber`, then wrap modulo the width. */
  get wrap(): IntegerType {
    this.#refusesBigInt(".wrap");
    return new IntegerType(this.info, `WebCore::${this.info.webidl}`);
  }
  /** WebIDL `[Clamp]`. */
  get clamp(): IntegerType {
    this.#refusesBigInt(".clamp");
    return new IntegerType(this.info, `WebCore::IDLClampAdaptor<WebCore::${this.info.webidl}>`);
  }
  /** WebIDL `[EnforceRange]` over `[min, max]`. */
  enforceRange(min = Number(this.info.min), max = Number(this.info.max)): RangeType {
    this.#refusesBigInt(".enforceRange()");
    return new RangeType(this.info, min, max, "enforceRange");
  }
  /** Node's `validateInteger` / `validateInt32` / `validateUint32`: `ERR_INVALID_ARG_TYPE`, `ERR_OUT_OF_RANGE`. */
  validateInteger(min = Number(this.info.min), max = Number(this.info.max)): RangeType {
    this.#refusesBigInt(".validateInteger()");
    return new RangeType(this.info, min, max, "validateInteger");
  }
  /** As a result: a BigInt, which holds every `u64`. */
  get asBigInt(): BigIntResultType {
    assert(this.info.rust === "u64" && this.#conversion === "Strict" && !this.#allowBigInt, ".asBigInt follows b.u64");
    return new BigIntResultType();
  }
  #refusesBigInt(modifier: string): void {
    assert(!this.#allowBigInt, `${modifier} refuses a BigInt, which .allowBigInt asked for`);
  }
  get elementTest() {
    return this.layout().size > 4 ? null : (value: string) => `${value}.is_number()`;
  }
  get unionCategory(): UnionCategory {
    return "number";
  }
}

/** What a body returns and nothing takes, so it has no C++ type. */
export abstract class ResultType extends Type {
  readonly idlType = "";
  /** What a schema that takes one is told. */
  abstract readonly refusal: string;
  abstract get resultType(): TypeSpec;
  get parameterType(): ParameterType {
    return strictType(this.resultType);
  }
  layout(): never {
    throw new TypeError(this.refusal);
  }
  rustExternType(): never {
    return this.layout();
  }
}

export class BigIntResultType extends ResultType {
  readonly tsType = "bigint";
  readonly refusal = ".asBigInt is a result; an argument is b.u64.allowBigInt";
  get resultType(): TypeSpec {
    return bigIntType;
  }
  rustType(): string {
    return "u64";
  }
  rustToJS(value: string): string {
    return `bindgen::to_js::u64_as_bigint(heap, ${value})`;
  }
}

export class RangeType extends IntegerType {
  readonly modifier: "enforceRange" | "validateInteger";
  readonly #range: readonly [number, number];
  constructor(info: IntegerInfo, min: number, max: number, modifier: "enforceRange" | "validateInteger") {
    assert(
      Number.isSafeInteger(min) && Number.isSafeInteger(max) && min <= max,
      `[${min}, ${max}] is not a range of integers`,
    );
    assert(min >= Number(info.min) && max <= Number(info.max), `[${min}, ${max}] does not fit ${info.rust}`);
    const tag = modifier === "enforceRange" ? "IDLEnforceRange" : "IDLValidateInteger";
    super(
      info,
      `Bun::Bindgen::${tag}<${info.cpp}, ${min}, ${max}>`,
      false,
      modifier === "enforceRange" ? "any" : "number",
    );
    this.modifier = modifier;
    this.#range = [min, max];
  }
  protected get range() {
    return this.#range;
  }
  get parameterType(): ParameterType {
    const accepted = integersType(...this.range);
    return this.modifier === "enforceRange" ? convertingType(accepted, "ToNumber", numberType) : strictType(accepted);
  }
  get canRefuse(): boolean {
    return this.modifier === "enforceRange";
  }
  get loose(): never {
    throw new TypeError(`.${this.modifier}() says how the value converts; .loose is another way`);
  }
  get wrap(): never {
    throw new TypeError(`.${this.modifier}() says how the value converts; .wrap is another way`);
  }
  getHeaders(out: Set<string>): void {
    out.add("Bindgen/IDLConvertIntegerRange.h");
  }
  /** Its converter takes no context. That of `.validateInteger` takes the name. */
  cppConvertInto(target: string, value: string, ctx: string, name: string, failure: string): string {
    const reported = this.modifier === "validateInteger" ? `, ${asciiLiteral(name)}` : "";
    return cppReturnIfFailed(
      `WebCore::Converter<${this.idlType}>::convertInto(*globalObject, ${value}${reported}, ${target})`,
      failure,
    );
  }
}

const integer = (rust: string, cpp: string, size: number, webidl: string, min: number | bigint, max: number | bigint) =>
  new IntegerType({ rust, cpp, size, webidl, min, max });

export const integers = {
  i8: integer("i8", "int8_t", 1, "IDLByte", -128, 127),
  i16: integer("i16", "int16_t", 2, "IDLShort", -32768, 32767),
  i64: integer("i64", "int64_t", 8, "IDLLongLong", Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
  u8: integer("u8", "uint8_t", 1, "IDLOctet", 0, 255),
  u16: integer("u16", "uint16_t", 2, "IDLUnsignedShort", 0, 65535),
  i32: integer("i32", "int32_t", 4, "IDLLong", -2147483648, 2147483647),
  u32: integer("u32", "uint32_t", 4, "IDLUnsignedLong", 0, 4294967295),
  u64: integer("u64", "uint64_t", 8, "IDLUnsignedLongLong", 0, Number.MAX_SAFE_INTEGER),
  usize: integer("usize", "uint64_t", 8, "IDLUnsignedLongLong", 0, Number.MAX_SAFE_INTEGER),
};

export class DoubleType extends PrimitiveType {
  readonly #parameterType: ParameterType;
  constructor(
    idlType = "Bun::Bindgen::IDLStrictDouble",
    valueKinds: ValueKinds = ["number"],
    parameterType = strictType(numberType),
  ) {
    super(
      idlType,
      valueKinds === "any" ? "any" : valueKinds.includes(dateInstance) ? "number | Date" : "number",
      "f64",
      8,
      valueKinds,
    );
    this.#parameterType = parameterType;
  }
  get parameterType(): ParameterType {
    return this.#parameterType;
  }
  get directForm(): DirectForm | null {
    return this.valueKinds !== "any" && this.valueKinds.includes(dateInstance)
      ? null
      : { value: "Double", cppType: "double", type: numberType };
  }
  get resultType(): TypeSpec {
    return numberType;
  }
  get tryConvertThrows(): boolean {
    return false;
  }
  /** A `Date` too, as its time value, which is NaN for an invalid one. */
  get allowDate(): DoubleType {
    assert(this.idlType === "Bun::Bindgen::IDLStrictDouble", ".allowDate follows b.f64");
    return new DoubleType(
      "Bun::Bindgen::IDLStrictDoubleOrDate",
      ["number", dateInstance],
      strictType(unionType(numberType, instanceType("Date"))),
    );
  }
  /** As a result: a `Date` with that time value. */
  get asDate(): DateResultType {
    assert(this.idlType === "Bun::Bindgen::IDLStrictDouble", ".asDate follows b.f64");
    return new DateResultType();
  }
  /** `ToNumber`: WebIDL's `unrestricted double`. */
  get loose(): LooseDoubleType {
    assert(this.idlType === "Bun::Bindgen::IDLStrictDouble", ".loose follows b.f64");
    return new LooseDoubleType("WebCore::IDLUnrestrictedDouble", "any", convertingType(numberType, "ToNumber"));
  }
  get elementTest() {
    return (value: string) => `${value}.is_number()`;
  }
  get unionCategory(): UnionCategory {
    return "number";
  }
}

export class LooseDoubleType extends DoubleType {
  /** `ToNumeric`: a BigInt too, as the double nearest to it, for an argument whose type is `number | bigint`. */
  get allowBigInt(): DoubleType {
    return new DoubleType(
      "Bun::Bindgen::IDLLooseDoubleOrBigInt",
      "any",
      convertingType(unionType(numberType, bigIntType), "ToNumeric"),
    );
  }
}

/** WebIDL's `double`: what is not finite throws. `.strict` takes only a number, for an alternative of a union. */
export class FiniteDoubleType extends DoubleType {
  constructor(isStrict = false) {
    super(
      "WebCore::IDLDouble",
      isStrict ? ["number"] : "any",
      isStrict ? strictType(numberType) : convertingType(numberType, "ToNumber"),
    );
  }
  get strict(): FiniteDoubleType {
    return new FiniteDoubleType(true);
  }
  get directForm(): null {
    return null;
  }
  get canRefuse(): boolean {
    return true;
  }
  get tryConvertThrows(): boolean {
    return true;
  }
}

/** WebIDL's `float` and `unrestricted float`. */
export class FloatType extends PrimitiveType {
  readonly #isFinite: boolean;
  constructor(isFinite: boolean, isStrict = false) {
    super(
      `WebCore::IDL${isFinite ? "" : "Unrestricted"}Float`,
      isStrict ? "number" : "any",
      "f32",
      4,
      isStrict ? ["number"] : "any",
    );
    this.#isFinite = isFinite;
  }
  get strict(): FloatType {
    return new FloatType(this.#isFinite, true);
  }
  protected get cppName(): string {
    return "float";
  }
  get parameterType(): ParameterType {
    return this.valueKinds === "any" ? convertingType(numberType, "ToNumber") : strictType(numberType);
  }
  get resultType(): TypeSpec {
    return numberType;
  }
  get canRefuse(): boolean {
    return this.#isFinite;
  }
  get elementTest() {
    return (value: string) => `${value}.is_number()`;
  }
  get unionCategory(): UnionCategory {
    return "number";
  }
}

export class DateResultType extends ResultType {
  readonly tsType = "Date";
  readonly refusal = ".asDate is a result";
  get resultType(): TypeSpec {
    return { type: "Instance", class: "Date", freshness: "Yes" };
  }
  rustType(): string {
    return "f64";
  }
  rustToJS(value: string): string {
    return `bindgen::to_js::date(heap, ${value})`;
  }
}

/** Only as a union alternative or a return type. */
export class UnitType extends Type {
  readonly idlType: string;
  readonly unit: "null" | "undefined";
  constructor(unit: "null" | "undefined") {
    super();
    this.unit = unit;
    this.idlType = unit === "null" ? "Bun::Bindgen::IDLStrictNull" : "Bun::Bindgen::IDLStrictUndefined";
  }
  get tsType(): string {
    return this.unit === "null" ? "null | undefined" : "undefined";
  }
  get valueKinds(): ValueKinds {
    return this.unit === "null" ? ["undefined", "null"] : ["undefined"];
  }
  get parameterType(): ParameterType {
    return strictType(this.unit === "null" ? nullishType : undefinedType);
  }
  get takesUndefined(): boolean {
    return true;
  }
  cppConvertInto(): string {
    throw new TypeError(`b.${this.unit} is only an alternative of a union`);
  }
  get elementTest() {
    return (value: string) => `${value}.is_null()`;
  }
  layout(): Layout {
    return { size: 1, align: 1 };
  }
  rustExternType(): string {
    return "u8";
  }
  rustType(): string {
    return "()";
  }
  rustFromExtern(): string {
    return "()";
  }
  rustToJS(value: string): string {
    assert(this.unit === "undefined", "leave `returns` out, or return a nullable type");
    return `bindgen::to_js::undefined(heap, ${value})`;
  }
}

// ───────────────────────────── strings, values, buffers ─────────────────────────────

/** A `bun_core::String` sharing the JS string's `StringImpl`. */
export class StringType extends Type {
  readonly idlType: string;
  readonly #valueKinds: ValueKinds;
  constructor(idlType = "Bun::Bindgen::IDLStrictString", valueKinds: ValueKinds = ["string"]) {
    super();
    this.idlType = idlType;
    this.#valueKinds = valueKinds;
  }
  get tsType(): string {
    return this.valueKinds === "any" ? "any" : "string";
  }
  get valueKinds(): ValueKinds {
    return this.#valueKinds;
  }
  get parameterType(): ParameterType {
    return stringParameterType(this.valueKinds);
  }
  get resultType(): TypeSpec {
    return stringType;
  }
  get rustIsCopy(): boolean {
    return false;
  }
  /** `ToString`: any value is accepted. */
  get loose(): StringType {
    assert(!this.valueKinds.includes("stringObject"), ".loose already takes a String object");
    return new StringType("WebCore::IDLDOMString", "any");
  }
  /** Also takes a `String` object, as `.utf8` does. */
  get allowStringObject(): StringType {
    assert(this.valueKinds !== "any", ".loose already takes a String object");
    return new StringType("Bun::Bindgen::IDLStrictStringOrStringObject", ["string", "stringObject"]);
  }
  /** `&[u8]`, UTF-8, for the duration of the call, instead of a string. Also takes a `String` object. */
  get utf8(): Utf8Type {
    return new Utf8Type(this.valueKinds === "any");
  }
  /** As an argument: `bun_core::String` by value, for a body that keeps it, instead of `&bun_core::String`. */
  get owned(): OwnedStringType {
    return new OwnedStringType(this.idlType, this.valueKinds);
  }
  /** `bun_core::StringView<'a>` for the duration of the call, for a body that only reads the characters. It takes no reference, and a slice of another string is not copied out of it. */
  get view(): StringViewType {
    assert(this.valueKinds !== "any", ".view follows b.string or b.string.allowStringObject");
    return new StringViewType(this.valueKinds);
  }
  /** The JS string itself, a `JsLocal<'a, JSString>`: nothing is resolved, counted or copied. */
  get local(): LocalStringType {
    assert(this.valueKinds !== "any", ".local follows b.string or b.string.allowStringObject");
    return new LocalStringType(this.valueKinds.includes("stringObject"));
  }
  get nullRepresentation() {
    return "pointer" as const;
  }
  get borrowedByBody(): boolean {
    return true;
  }
  toCpp(value: unknown): string {
    assert(typeof value === "string", `${util.inspect(value)} is not a string`);
    return `WTF::String { ${asciiLiteral(value)} }`;
  }
  toRust(value: unknown): string {
    return value === "" ? "bun_core::String::EMPTY" : `bun_core::String::static_(${JSON.stringify(value)})`;
  }
  get unionCategory(): UnionCategory {
    return "string";
  }
  layout(): Layout {
    return { size: 8, align: 8 };
  }
  rustExternType(): string {
    return "bindgen::extern_types::ExternString";
  }
  rustType(): string {
    return "bun_core::String";
  }
  rustFromExtern(expr: string): string {
    return `bindgen::extern_types::adopt_string(${expr})`;
  }
  rustToJS(value: string): string {
    return `bindgen::to_js::string(heap, ${value})`;
  }
  rustArrayToJS(value: string): string | null {
    return `bindgen::to_js::string_array(heap, ${value})`;
  }
}

export class StringViewType extends Type {
  readonly tsType = "string";
  readonly #valueKinds: ValueKinds;
  constructor(valueKinds: ValueKinds) {
    super();
    this.#valueKinds = valueKinds;
  }
  get idlType(): string {
    return `Bun::Bindgen::IDLStringView<${this.valueKinds.includes("stringObject")}>`;
  }
  get valueKinds(): ValueKinds {
    return this.#valueKinds;
  }
  get parameterType(): ParameterType {
    return stringParameterType(this.valueKinds);
  }
  get borrowsFrame(): boolean {
    return true;
  }
  get borrowedByBody(): boolean {
    return true;
  }
  get rustIsCopy(): boolean {
    return false;
  }
  layout(): Layout {
    return { size: 16, align: 8 };
  }
  rustExternType(): string {
    return "bindgen::extern_types::ExternStringView";
  }
  rustType(): string {
    return "bun_core::StringView<'a>";
  }
  rustFromExtern(expr: string): string {
    return `${expr}.get(heap)`;
  }
}

/** Bytes that C++ has: `std::span<const uint8_t>` there, `&'a [u8]` in Rust. */
export class ByteSpanType extends Type {
  readonly idlType = "Bun::Bindgen::IDLByteSpan";
  readonly tsType = "never";
  get parameterType(): ParameterType {
    return strictType(neverType);
  }
  get borrowsFrame(): boolean {
    return true;
  }
  layout(): Layout {
    return { size: 16, align: 8 };
  }
  rustExternType(): string {
    return "bindgen::extern_types::ExternBytes";
  }
  rustType(): string {
    return "&'a [u8]";
  }
  rustFromExtern(expr: string): string {
    return `${expr}.get_optional(heap).unwrap_or_default()`;
  }
}

export class OwnedStringType extends StringType {
  get refusalOutsideArgument(): string {
    return ".owned is only for an argument: everywhere else the string is already by value";
  }
  get borrowedByBody(): boolean {
    return false;
  }
  get local(): never {
    throw new TypeError(".local follows b.string");
  }
  get view(): never {
    throw new TypeError(".view borrows the string and .owned keeps it");
  }
  get loose(): never {
    throw new TypeError("write b.string.loose.owned");
  }
  get allowStringObject(): never {
    throw new TypeError("write b.string.allowStringObject.owned");
  }
  get utf8(): never {
    throw new TypeError("write b.string.utf8.owned");
  }
  get owned(): never {
    throw new TypeError("already .owned");
  }
}

/** UTF-8 to keep: the JS string's own buffer, shared, when it is 8-bit ASCII, otherwise a transcoded copy. */
export class OwnedUtf8Type extends StringType {
  get borrowedByBody(): boolean {
    return false;
  }
  rustArrayToJS(): null {
    return null;
  }
  get owned(): never {
    throw new TypeError("already .owned");
  }
  get view(): never {
    throw new TypeError(".view borrows the string and .owned keeps it");
  }
  get loose(): never {
    throw new TypeError("write b.string.loose.utf8.owned");
  }
  get allowStringObject(): never {
    throw new TypeError("b.string.utf8.owned already takes a String object");
  }
  get utf8(): never {
    throw new TypeError("b.string.utf8.owned is already UTF-8");
  }
  get local(): never {
    throw new TypeError("b.string.utf8.owned is kept; b.string.local is for the call");
  }
  toCpp(): never {
    throw new TypeError("b.string.utf8.owned cannot have a default");
  }
  rustType(): string {
    return "bun_core::Utf8Bytes<'static>";
  }
  rustFromExtern(expr: string): string {
    return `${super.rustFromExtern(expr)}.into_utf8()`;
  }
  rustToJS(): string {
    throw new TypeError("return b.string.utf8");
  }
}

const cppStringOfStringObject = (value: string) => `Bun::Bindgen::stringOfStringObject(*globalObject, ${value})`;

/** The `JSString` cell. */
export class LocalStringType extends Type {
  readonly idlType: string = "Bun::Bindgen::IDLRawString";
  readonly tsType: string = "string";
  readonly #allowStringObject: boolean;
  constructor(allowStringObject: boolean) {
    super();
    this.#allowStringObject = allowStringObject;
  }
  get valueKinds(): ValueKinds {
    return this.#allowStringObject ? ["string", "stringObject"] : ["string"];
  }
  get parameterType(): ParameterType {
    return stringParameterType(this.valueKinds);
  }
  get resultType(): TypeSpec {
    return stringType;
  }
  get directForm(): DirectForm | null {
    return { value: "Value", type: stringType, cppType: "JSC::JSString*" };
  }
  get isReadInPlace(): boolean {
    return true;
  }
  get holdsJSValue(): boolean {
    return true;
  }
  get nullRepresentation() {
    return "pointer" as const;
  }
  cppPrepare(value: string): string | null {
    return this.#allowStringObject ? cppStringOfStringObject(value) : null;
  }
  get elementTest() {
    return (value: string) => `${value}.is_string_literal()`;
  }
  get unionCategory(): UnionCategory {
    return "string";
  }
  layout(): Layout {
    return { size: 8, align: 8 };
  }
  rustExternType(): string {
    return "*mut core::ffi::c_void";
  }
  rustType(): string {
    return "bindgen::JsLocal<'a, bun_jsc::JSString>";
  }
  rustFromExtern(expr: string): string {
    return `bindgen::JsLocal::<bun_jsc::JSString>::from_cell(${expr}, heap)`;
  }
  rustToJS(value: string): string {
    return `bindgen::to_js::any(heap, ${value})`;
  }
}

/** What `ToString` gives, as the `JSString` cell. */
export class WebStringType extends LocalStringType {
  readonly idlType: string;
  readonly tsType = "any";
  readonly #kind: "DOMString" | "USVString" | "ByteString";
  readonly #nullToEmpty: boolean;
  constructor(kind: "DOMString" | "USVString" | "ByteString", nullToEmpty = false) {
    super(false);
    this.#kind = kind;
    this.#nullToEmpty = nullToEmpty;
    this.idlType = `Bun::Bindgen::IDLWebString<Bun::Bindgen::WebString::${kind}, ${nullToEmpty}>`;
  }
  /** `[LegacyNullToEmptyString]`. */
  get nullToEmpty(): WebStringType {
    return new WebStringType(this.#kind, true);
  }
  /** `&[u8]`. A lone surrogate becomes U+FFFD. */
  get utf8(): Utf8Type {
    assert(this.#kind !== "ByteString", "a ByteString is Latin-1");
    return new Utf8Type(true, this.#nullToEmpty);
  }
  /** The `StringImpl` of the string, a `bindgen::JsStringImpl<'a>`. No reference is taken. */
  get impl(): StringImplType {
    return new StringImplType(`Bun::Bindgen::IDLStringImplOf<${this.idlType}>`, "JsStringImpl", this.parameterType);
  }
  /** The `AtomStringImpl` of the string, a `bindgen::JsAtom<'a>`. */
  get atom(): StringImplType {
    return new StringImplType(`Bun::Bindgen::IDLAtomOf<${this.idlType}>`, "JsAtom", this.parameterType);
  }
  get valueKinds(): ValueKinds {
    return "any";
  }
  get parameterType(): ParameterType {
    return this.#nullToEmpty ? nullToEmptyParameterType : super.parameterType;
  }
  get directForm(): DirectForm | null {
    return this.#kind === "DOMString" ? super.directForm : null;
  }
  get canRefuse(): boolean {
    return this.#kind === "ByteString";
  }
  toCpp(value: unknown): string {
    assert(typeof value === "string", `${util.inspect(value)} is not a string`);
    return value === ""
      ? "JSC::jsEmptyString(JSC::getVM(globalObject))"
      : `JSC::jsString(JSC::getVM(globalObject), WTF::String { ${asciiLiteral(value)} })`;
  }
  /** Not a constant: it is a cell. */
  get hasRustDefault(): boolean {
    return false;
  }
}

/** The characters of a flat JS string, through the cell that holds them. */
export class StringImplType extends LocalStringType {
  readonly idlType: string;
  readonly tsType = "any";
  readonly #rust: string;
  readonly #parameterType: ParameterType;
  constructor(idlType: string, rust: string, parameterType: ParameterType) {
    super(false);
    this.idlType = idlType;
    this.#rust = rust;
    this.#parameterType = parameterType;
  }
  get valueKinds(): ValueKinds {
    return "any";
  }
  get parameterType(): ParameterType {
    return this.#parameterType;
  }
  get directForm(): null {
    return null;
  }
  toCpp(value: unknown): string {
    assert(typeof value === "string", `${util.inspect(value)} is not a string`);
    return `Bun::Bindgen::atomLiteral(*globalObject, ${asciiLiteral(value)})`;
  }
  get hasRustDefault(): boolean {
    return false;
  }
  layout(): Layout {
    return { size: 16, align: 8 };
  }
  rustExternType(): string {
    return "bindgen::ExternStringAndImpl";
  }
  rustType(): string {
    return `bindgen::${this.#rust}<'a>`;
  }
  rustFromExtern(expr: string): string {
    return `bindgen::${this.#rust}::from_extern(${expr}, heap)`;
  }
  rustToJS(value: string): string {
    return `bindgen::to_js::string_impl(heap, ${value})`;
  }
  /** The type at `rustPath`, which is `From` it and takes a reference. */
  as(rustPath: string): OwnedStringImplType {
    return new OwnedStringImplType(this.idlType, this.#rust, this.#parameterType, rustPath);
  }
}

const isOwnedString = (type: Type) => (type instanceof OptionalType ? type.inner : type) instanceof OwnedStringImplType;

export class OwnedStringImplType extends StringImplType {
  readonly #path: string;
  constructor(idlType: string, rust: string, parameterType: ParameterType, path: string) {
    super(idlType, rust, parameterType);
    this.#path = path;
  }
  get rustIsCopy(): boolean {
    return false;
  }
  get bodyMayBorrow(): boolean {
    return true;
  }
  rustType(): string {
    return this.#path;
  }
  rustFromExtern(expr: string): string {
    return `${this.#path}::from(${super.rustFromExtern(expr)})`;
  }
}

/** UTF-8 bytes for the duration of the call: `Bun::Bindgen::JSStringUTF8View`. */
export class Utf8Type extends Type {
  readonly isLoose: boolean;
  readonly #nullToEmpty: boolean;
  constructor(isLoose: boolean, nullToEmpty = false) {
    super();
    this.isLoose = isLoose;
    this.#nullToEmpty = nullToEmpty;
  }
  get tsType(): string {
    return this.isLoose ? "any" : "string";
  }
  get idlType(): string {
    return `Bun::Bindgen::IDL${this.isLoose ? "Loose" : "Strict"}UTF8String`;
  }
  /** `bun_core::Utf8Bytes<'static>`, for a body that stores the string. */
  get owned(): OwnedUtf8Type {
    return this.isLoose
      ? new OwnedUtf8Type("WebCore::IDLDOMString", "any")
      : new OwnedUtf8Type("Bun::Bindgen::IDLStrictStringOrStringObject", this.valueKinds);
  }
  get valueKinds(): ValueKinds {
    return this.isLoose ? "any" : ["string", "stringObject"];
  }
  get parameterType(): ParameterType {
    return this.#nullToEmpty ? nullToEmptyParameterType : stringParameterType(this.valueKinds);
  }
  get resultType(): TypeSpec {
    return stringType;
  }
  get borrowsFrame(): boolean {
    return true;
  }
  get nullRepresentation() {
    return "pointer" as const;
  }
  get convertsInPlace(): boolean {
    return true;
  }
  cppConvertInto(target: string, value: string, ctx: string, name: string, failure: string): string {
    if (this.#nullToEmpty) value = `(${value}.isNull() ? JSC::jsEmptyString(JSC::getVM(globalObject)) : ${value})`;
    return cppReturnIfFailed(cppConvertBytes(this, target, value, ctx, "a string"), failure);
  }
  cppAssign(target: string, value: unknown): string {
    assert(typeof value === "string", `${util.inspect(value)} is not a string`);
    return `${target}.initialize(${asciiLiteral(value)});`;
  }
  toRust(value: unknown): string {
    return `b${JSON.stringify(value)}`;
  }
  get unionCategory(): UnionCategory {
    return "string";
  }
  layout(): Layout {
    return { size: 16, align: 8 };
  }
  rustExternType(): string {
    return "bindgen::extern_types::ExternBytes";
  }
  rustType(): string {
    return "&'a [u8]";
  }
  rustFromExtern(expr: string): string {
    return `${expr}.get(heap)`;
  }
  rustResultFieldType(): string {
    return "Vec<u8>";
  }
  rustToJS(value: string): string {
    return `bindgen::to_js::utf8(heap, ${value})`;
  }
}

const bufferSourceKinds: ValueKinds = ["arrayBuffer", "arrayBufferView"];
const sharedBuffers = "shared buffers";

/** What each option means: docs/project/bindgen.mdx, "Bytes". */
export interface BytesOptions {
  from: readonly ("string" | "buffer" | "blob")[];
  otherwise?: "throw" | "toString";
  refuse?: readonly ("undefined" | "null" | "stringObject")[];
  string?: "utf8" | "asIs";
  shared?: "borrowed" | "copied";
  held?: "borrowed" | "handle" | "copied" | "pinned";
}

/** The bytes of an argument. Those of a buffer are read, copied or pinned once every argument is converted. */
export class BytesType extends Type {
  readonly #options: Required<BytesOptions>;
  constructor(options: BytesOptions) {
    super();
    const { from, otherwise = "throw", refuse = [], string = "utf8", shared = "borrowed", held = "borrowed" } = options;
    this.#options = { from, otherwise, refuse, string, shared, held };
    assert(from.length > 0, "from: it takes nothing");
    assertDistinct(from, "kinds");
    assertDistinct(refuse, "refused values");
    const refusesStringObject = refuse.includes("stringObject");
    assert(
      refuse.every(value => value === "stringObject") || otherwise === "toString",
      'refuse: without otherwise: "toString" undefined and null throw already',
    );
    assert(
      !refusesStringObject || from.includes("string"),
      'refuse: without from: "string" a String object throws already',
    );
    assert(!refusesStringObject || otherwise === "throw", 'refuse: "stringObject" is only with otherwise: "throw"');
    assert(string === "utf8" || from.includes("string") || otherwise === "toString", "string: it takes no string");
    assert(shared === "borrowed" || from.includes("buffer"), "shared: it takes no buffer");
    assert(shared === "borrowed" || held !== "copied", 'held: "copied" copies every buffer');
    // What no function needs yet is not written.
    assert(string === "utf8" || held === "handle", 'string: "asIs" is only with held: "handle"');
    assert(string === "utf8" || shared === "borrowed", 'string: "asIs" does not copy a shared buffer');
    assert(shared === "borrowed" || held !== "pinned", 'held: "pinned" pins a shared buffer; it does not copy one');
    assert(held !== "pinned" || !from.includes("blob"), 'held: "pinned" does not take a Blob');
  }
  /** C++ converts a string to UTF-8 in the frame. Otherwise Rust gets the string. */
  get #isView(): boolean {
    const { held, string } = this.#options;
    return string === "utf8" && (held === "borrowed" || held === "handle");
  }
  get idlType(): string {
    const { from, otherwise, refuse } = this.#options;
    const options = {
      fromString: from.includes("string"),
      fromBuffer: from.includes("buffer"),
      fromBlob: from.includes("blob"),
      toStringOtherwise: otherwise === "toString",
      refuseUndefined: refuse.includes("undefined"),
      refuseNull: refuse.includes("null"),
      refuseStringObject: refuse.includes("stringObject"),
    };
    const members = Object.entries(options).flatMap(([name, value]) => (value ? [`.${name} = true`] : []));
    const takesString = options.fromString || options.toStringOtherwise;
    const sink = !this.#isView ? "JSBlobOrStringOrBuffer" : takesString ? "JSBytesView" : "JSBlobOrBufferView";
    return `Bun::Bindgen::IDLBytes<Bun::Bindgen::${sink}, Bun::Bindgen::BytesOptions { ${members.join(", ")} }>`;
  }
  get tsType(): string {
    if (this.#options.otherwise === "toString") return "any";
    const spelling = {
      string: "string",
      buffer: "ArrayBuffer | SharedArrayBuffer | ArrayBufferView",
      blob: "globalThis.Blob",
    };
    return this.#options.from.map(kind => spelling[kind]).join(" | ");
  }
  get parameterType(): ParameterType {
    const { from, otherwise, refuse } = this.#options;
    const takesStringObject = otherwise === "throw" && !refuse.includes("stringObject");
    const taken = {
      string: takesStringObject ? stringOrStringObjectType : stringType,
      buffer: bufferTypes(true),
      blob: instanceType("Blob"),
    };
    const accepted = unionType(...from.map(kind => taken[kind]));
    if (otherwise === "throw") return strictType(accepted);
    return {
      ...convertingType(accepted, "ToString", unionType(accepted, stringType)),
      refused: unionType(
        ...(refuse.includes("undefined") ? [undefinedType] : []),
        ...(refuse.includes("null") ? [primitiveType("Null")] : []),
      ),
    };
  }
  /** A Blob that is a file, a buffer that cannot be pinned, no memory for a copy. */
  get canRefuse(): boolean {
    const { from, shared, held } = this.#options;
    return from.includes("blob") || held === "pinned" || shared === "copied";
  }
  get passesValue(): boolean {
    return this.#options.held !== "borrowed";
  }
  get borrowsHeap(): boolean {
    return this.#options.held === "borrowed";
  }
  canBe(modifier: OptionalType["modifier"]): boolean {
    return this.#options.held === "borrowed" || (this.#options.string === "asIs" && modifier === "nullable");
  }
  get nullRepresentation() {
    return "pointer" as const;
  }
  get convertsInPlace(): boolean {
    return true;
  }
  cppConvertInto(target: string, value: string, ctx: string, name: string, failure: string): string {
    const spelling = { string: ["a string"], buffer: ["ArrayBuffer", "ArrayBufferView"], blob: ["Blob"] };
    const expected = (["string", "buffer", "blob"] as const)
      .filter(kind => this.#options.from.includes(kind))
      .flatMap(kind => spelling[kind]);
    if (!this.#options.from.includes("string")) expected[0] = `${/^A/.test(expected[0]) ? "an" : "a"} ${expected[0]}`;
    const last = expected.pop();
    const list = expected.length > 0 ? `${expected.join(", ")} or ${last}` : last!;
    return cppReturnIfFailed(cppConvertBytes(this, target, value, ctx, list), failure);
  }
  cppReadLast(target: string, value: string): string[] {
    if (!this.#isView) return [];
    if (this.#options.shared === "copied")
      return [
        `Bun::Bindgen::BytesCopy ${target}Copy;`,
        ...cppReturnIfFailed(
          `${target}.${this.#options.held === "borrowed" ? "readCopyingShared" : "copyIfShared"}(*globalObject, ${value}, ${target}Copy)`,
          "{}",
        ).split("\n"),
      ];
    return this.#options.held === "borrowed" ? [`${target}.read(${value});`] : [];
  }
  layout(): Layout {
    const converted = this.#isView ? { size: 16, align: 8 } : { size: 8, align: 8 };
    return this.passesValue ? structLayout([converted, { size: 8, align: 8 }]) : converted;
  }
  rustExternType(): string {
    const converted = `bindgen::extern_types::Extern${this.#isView ? "Bytes" : "String"}`;
    return this.passesValue ? `bindgen::extern_types::ExternWithValue<${converted}>` : converted;
  }
  /** What the body gets, and the expression that makes it of `argument`. */
  #rust(argument: string): readonly [type: string, fromExtern: string] {
    const stringOrBytes = `bindgen::StringOrJsBytes::from_extern(${argument}, heap)`;
    if (this.#options.string === "asIs") return ["bindgen::StringOrJsBytes<'a>", stringOrBytes];
    return (
      {
        borrowed: ["&'a [u8]", `${argument}.get(heap)`],
        handle: ["bindgen::JsBytes<'a>", `bindgen::JsBytes::from_extern(${argument}, heap)`],
        copied: ["Vec<u8>", `${stringOrBytes}.into_vec(heap)`],
        pinned: ["bindgen::PinnedBytes", `bindgen::PinnedBytes::from_extern(${argument}, heap)`],
      } as const
    )[this.#options.held];
  }
  rustType(): string {
    return this.#rust("")[0];
  }
  get rustFromExternThrows(): boolean {
    return this.#options.held === "pinned";
  }
  rustFromExtern(expr: string): string {
    return this.#rust(expr)[1];
  }
  rustFromExternOptional(expr: string): string {
    return this.#options.string === "asIs"
      ? `bindgen::StringOrJsBytes::from_extern_optional(${expr}, heap)`
      : `${expr}.get_optional(heap)`;
  }
}

/** A typed array, `DataView` or `ArrayBuffer`, as a handle whose bytes are read through `with_bytes`. */
export class BufferSourceType extends Type {
  readonly #allowShared: boolean;
  constructor(allowShared = false) {
    super();
    this.#allowShared = allowShared;
  }
  get idlType(): string {
    return `Bun::Bindgen::IDLRawBufferSource<${this.#allowShared}>`;
  }
  get tsType(): string {
    return `ArrayBuffer | ArrayBufferView${this.#allowShared ? " | SharedArrayBuffer" : ""}`;
  }
  get valueKinds(): ValueKinds {
    return bufferSourceKinds;
  }
  get parameterType(): ParameterType {
    return strictType(bufferTypes(this.#allowShared));
  }
  get refuses() {
    return this.#allowShared ? null : sharedBuffers;
  }
  /** WebIDL's `[AllowShared]`. */
  get allowShared(): BufferSourceType {
    return new BufferSourceType(true);
  }
  /** A reference on a `JSC::ArrayBuffer`, which can be stored: the buffer itself, or a copy of what a view shows. */
  get arrayBuffer(): RefType {
    assert(!this.#allowShared, ".arrayBuffer is a buffer that is not shared");
    return new RefType(
      "Bun::Bindgen::IDLArrayBufferRef",
      this.tsType,
      "bun_jsc::JSCArrayBuffer",
      null,
      bufferSourceKinds,
      sharedBuffers,
      bufferTypes(false),
    );
  }
  get holdsJSValue(): boolean {
    return true;
  }
  get returnsValueUnchanged(): boolean {
    return true;
  }
  get elementTest() {
    return (value: string) => `${value}.is_cell() && ${value}.js_type().is_array_buffer_like()`;
  }
  layout(): Layout {
    return { size: 8, align: 8 };
  }
  rustExternType(): string {
    return "JSValue";
  }
  rustType(): string {
    return "bindgen::JsLocal<'a, bindgen::BufferSource>";
  }
  rustFromExtern(expr: string): string {
    return `bindgen::JsLocal::from_extern(${expr}, heap)`;
  }
  rustToJS(value: string): string {
    return `bindgen::to_js::any(heap, ${value})`;
  }
}

/** A JS value of some kind, as itself. */
export class LocalType extends Type {
  readonly idlType: string;
  readonly tsType: string;
  readonly #marker: string;
  readonly #valueKinds: ValueKinds;
  readonly #refuses: string | null;
  readonly #accepted: TypeSpec;
  constructor(
    idlType: string,
    tsType: string,
    marker: string,
    valueKinds: ValueKinds,
    refuses: string | null,
    accepted: TypeSpec,
  ) {
    super();
    this.idlType = idlType;
    this.tsType = tsType;
    this.#marker = marker;
    this.#valueKinds = valueKinds;
    this.#refuses = refuses;
    this.#accepted = accepted;
  }
  get valueKinds(): ValueKinds {
    return this.#valueKinds;
  }
  get refuses(): string | null {
    return this.#refuses;
  }
  get parameterType(): ParameterType {
    return strictType(this.#accepted);
  }
  get directForm(): DirectForm | null {
    return { value: "Value", cppType: "JSC::EncodedJSValue", type: this.#accepted };
  }
  get holdsJSValue(): boolean {
    return true;
  }
  get returnsValueUnchanged(): boolean {
    return true;
  }
  get elementTest() {
    return (value: string) => (this === callableType ? `${value}.is_callable()` : "");
  }
  get unionCategory(): UnionCategory {
    return refusesNonObjects(this) ? "object" : "kind";
  }
  layout(): Layout {
    return { size: 8, align: 8 };
  }
  rustExternType(): string {
    return "JSValue";
  }
  rustType(): string {
    return `bindgen::JsLocal<'a, ${this.#marker}>`;
  }
  rustFromExtern(expr: string): string {
    return `bindgen::JsLocal::from_extern(${expr}, heap)`;
  }
  rustToJS(value: string): string {
    return `bindgen::to_js::any(heap, ${value})`;
  }
}
export const objectType = new LocalType(
  "Bun::Bindgen::IDLRawObject",
  "object",
  "bun_jsc::JSObject",
  "any",
  nonObjects,
  { type: "Object" },
);
export const jsArrayType = new LocalType(
  "Bun::Bindgen::IDLRawArray",
  "any[]",
  "bun_jsc::JSArray",
  ["array"],
  null,
  instanceType("Array"),
);
/** A function, or a proxy of one, for the body to call or to store. */
export const callableType = new LocalType(
  "Bun::Bindgen::IDLRawCallable",
  "((...args: any[]) => any)",
  "bindgen::Callable",
  ["callable"],
  null,
  { type: "Function" },
);

export class AnyType extends Type {
  readonly idlType = "Bun::Bindgen::IDLRawAny";
  readonly tsType = "any";
  readonly #stringObjectAsString: boolean;
  readonly #orAbsent: boolean;
  readonly #declared: readonly DeclaredResult[] | null;
  #omittable = false;
  constructor(stringObjectAsString = false, orAbsent = false, declared: readonly DeclaredResult[] | null = null) {
    super();
    this.#stringObjectAsString = stringObjectAsString;
    this.#orAbsent = orAbsent;
    this.#declared = declared;
  }
  /** This argument and every one after it. Only for the last argument. */
  get variadic(): VariadicType {
    return new VariadicType();
  }
  /** A `String` object arrives as what `ToString` gives for it, for a body that tells a string from anything else itself. */
  get stringObjectAsString(): AnyType {
    return new AnyType(true, this.#orAbsent, this.#declared);
  }
  /** For a result that the body makes itself: what it is. */
  returning(...alternatives: readonly DeclaredResult[]): AnyType {
    assert(alternatives.length > 0, ".returning takes what the result can be");
    assertDistinct(
      alternatives.filter(alternative => typeof alternative === "string"),
      "of .returning",
    );
    for (const alternative of alternatives) if (typeof alternative === "string") parseDeclaredAlternative(alternative);
    return new AnyType(this.#stringObjectAsString, this.#orAbsent, alternatives);
  }
  /** The words of `.returning`, if it was given words alone: what the generated C++ holds the result to. */
  get checkedResult(): readonly string[] | null {
    const declared = this.#declared ?? [];
    const words = declared.filter(alternative => typeof alternative === "string");
    return words.length > 0 && words.length === declared.length ? words : null;
  }
  get isDeclaredResult(): boolean {
    return this.#declared !== null;
  }
  get resultType(): TypeSpec {
    return this.#declared === null ? super.resultType : unionType(...this.#declared.map(typeOfDeclaredResult));
  }
  /** WebIDL's `optional any`: it is `undefined` if it is left out. */
  get omittable(): AnyType {
    const type = new AnyType(this.#stringObjectAsString, this.#orAbsent, this.#declared);
    type.#omittable = true;
    return type;
  }
  get isOmittable(): boolean {
    return this.#omittable || this.#orAbsent;
  }
  /** An `Option<JsLocal<'a>>`, for an argument that a caller may leave out. */
  get orAbsent(): AnyType {
    return new AnyType(this.#stringObjectAsString, true, this.#declared);
  }
  cppPrepare(value: string): string | null {
    return this.#stringObjectAsString ? cppStringOfStringObject(value) : null;
  }
  get parameterType(): ParameterType {
    return { ...strictType({ type: "Anything" }), mode: this.#orAbsent ? "Optional" : "Required" };
  }
  get directForm(): DirectForm {
    const type: TypeSpec = this.#stringObjectAsString ? stringType : { type: "Anything" };
    return { value: this.#orAbsent ? "ValueOrEmpty" : "Value", cppType: "JSC::EncodedJSValue", type };
  }
  get isOptional(): boolean {
    return this.#orAbsent;
  }
  get holdsJSValue(): boolean {
    return true;
  }
  get returnsValueUnchanged(): boolean {
    return true;
  }
  get takesUndefined(): boolean {
    return true;
  }
  get conversionThrows(): boolean {
    return false;
  }
  toCpp(value: unknown): string {
    assert(value === undefined, "b.any cannot have a default");
    return "JSC::jsUndefined()";
  }
  toRust(): string {
    return "bindgen::JsLocal::UNDEFINED";
  }
  get elementTest() {
    return (value: string) => ``;
  }
  layout(): Layout {
    return { size: 8, align: 8 };
  }
  rustExternType(): string {
    return "JSValue";
  }
  rustType(): string {
    return this.#orAbsent ? "Option<bindgen::JsLocal<'a>>" : "bindgen::JsLocal<'a>";
  }
  rustFromExtern(expr: string): string {
    return `bindgen::JsLocal::${this.#orAbsent ? "from_extern_or_absent" : "from_extern"}(${expr}, heap)`;
  }
  rustToJS(value: string): string {
    assert(!this.#orAbsent, ".orAbsent is for an argument");
    return `bindgen::to_js::any(heap, ${value})`;
  }
}

/** This argument and every one after it, borrowed from the call frame. */
export class VariadicType extends Type {
  readonly idlType = "Bun::Bindgen::IDLVariadicArguments";
  readonly tsType = "any[]";
  get parameterType(): ParameterType {
    return { ...strictType({ type: "Anything" }), mode: "Rest" };
  }
  /** The pointer and the count are the two words of the struct, which is passed in two registers as they would be. */
  get directForm(): DirectForm {
    return { value: "RestOfValues", type: { type: "Anything" }, cppType: "Bun::Bindgen::ExternVariadicArguments" };
  }
  get holdsJSValue(): boolean {
    return true;
  }
  get takesUndefined(): boolean {
    return true;
  }
  get isOptional(): boolean {
    return true;
  }
  get conversionThrows(): boolean {
    return false;
  }
  layout(): Layout {
    return { size: 16, align: 8 };
  }
  rustExternType(): string {
    return "bindgen::extern_types::ExternVariadicArguments";
  }
  rustType(): string {
    return "&'a [bindgen::JsLocal<'a>]";
  }
  rustFromExtern(expr: string): string {
    return `${expr}.get(heap)`;
  }
}

/** A ref-counted native object taken out of its JS wrapper. */
export class RefType extends Type {
  readonly idlType: string;
  readonly tsType: string;
  readonly pointee: string;
  readonly header: string | null;
  readonly #valueKinds: ValueKinds;
  readonly #refuses: string | null;
  readonly #accepted: TypeSpec;
  /** `accepted` is for `parameterType`. Left out: the instances of the class that `tsType` names. */
  constructor(
    idlType: string,
    tsType: string,
    pointee: string,
    header: string | null,
    valueKinds: ValueKinds,
    refuses: string | null,
    accepted = instanceType(tsType),
  ) {
    super();
    this.idlType = idlType;
    this.tsType = tsType;
    this.pointee = pointee;
    this.header = header;
    this.#valueKinds = valueKinds;
    this.#refuses = refuses;
    this.#accepted = accepted;
  }
  get valueKinds(): ValueKinds {
    return this.#valueKinds;
  }
  get parameterType(): ParameterType {
    return strictType(this.#accepted);
  }
  get refuses() {
    return this.#refuses;
  }
  get rustIsCopy(): boolean {
    return false;
  }
  get nullRepresentation() {
    return "pointer" as const;
  }
  getHeaders(out: Set<string>): void {
    if (this.header) out.add(this.header);
  }
  layout(): Layout {
    return { size: 8, align: 8 };
  }
  /** Untyped: C++ never looks inside, and `improper_ctypes` would follow a typed pointer into the pointee. */
  rustExternType(): string {
    return "*mut core::ffi::c_void";
  }
  rustType(): string {
    return `bun_core::ExternalShared<${this.pointee}>`;
  }
  rustFromExtern(expr: string): string {
    return `bun_core::ExternalShared::<${this.pointee}>::adopt(${expr}.cast())`;
  }
}

/** The `*mut T` that `JSValue::then` gave a promise reaction as its context. Only the promise calls a reaction, so nothing tests the value. */
export class PromisePtrType extends Type {
  readonly tsType = "never";
  readonly pointee: string;
  constructor(pointee: string) {
    super();
    this.pointee = pointee;
  }
  get idlType(): string {
    return "Bun::Bindgen::IDLPromisePtr";
  }
  get parameterType(): ParameterType {
    return strictType({ type: "Anything" });
  }
  get refusalOutsideArgument(): string {
    return "the context of a promise reaction is an argument, alone or with .withValue";
  }
  get conversionThrows(): boolean {
    return false;
  }
  layout(): Layout {
    return { size: 8, align: 8 };
  }
  /** Untyped, as for `RefType`. */
  rustExternType(): string {
    return "*mut core::ffi::c_void";
  }
  rustType(): string {
    return `*mut ${this.pointee}`;
  }
  rustFromExtern(expr: string): string {
    return `${expr}.cast::<${this.pointee}>()`;
  }
}

/** As `PromisePtrType`, for the `NativePromiseContext` cell that `JSValue::then_with_value` gave the reaction: what `take` hands back. */
export class NativePromiseContextType extends PromisePtrType {
  get idlType(): string {
    return "Bun::Bindgen::IDLNativePromiseContext";
  }
  getHeaders(out: Set<string>): void {
    out.add("Bindgen/IDLConvertNativePromiseContext.h");
  }
  rustType(): string {
    return `Option<bun_ptr::RefPtr<${this.pointee}>>`;
  }
  rustFromExtern(expr: string): string {
    return `core::ptr::NonNull::new(${super.rustFromExtern(expr)}).map(|context| bun_ptr::RefPtr::from_raw(context.as_ptr()))`;
  }
}

// ───────────────────────────── combinators ─────────────────────────────

export class OptionalType extends Type {
  readonly inner: Type;
  readonly modifier: "optional" | "nullable" | "falsyAsNull" | "emptyStringAsNull" | "otherAsNull" | "ifPassed";
  readonly #omittable: boolean;
  constructor(inner: Type, modifier: OptionalType["modifier"], omittable = modifier !== "nullable") {
    super();
    this.#omittable = omittable;
    assert(!(inner instanceof OptionalType), "already optional");
    assert(!(inner instanceof DefaultType), "put .default() last");
    assert(!(inner instanceof WithValueType), "put .withValue last");
    if (!inner.passesValue) refuseOutsideArgument(inner);
    if (modifier === "otherAsNull") {
      assert(!(inner instanceof UnionType), "a union takes the rest as its last alternative: ignored: b.any");
      assert(
        inner.valueKinds !== "any" || refusesNonObjects(inner),
        ".otherAsNull goes by the kind of a value, and this type does not: write it without .loose or nonObjectAsEmpty",
      );
      assert(
        !inner.insteadOfOtherAsNull,
        `.otherAsNull goes by the kind of a value, and this type throws for a value of a kind it takes: ${inner.insteadOfOtherAsNull}`,
      );
    }
    // `.ifPassed` does not claim `undefined`, so it goes on a type that takes it.
    if (modifier !== "ifPassed") {
      if (inner instanceof AnyType)
        assert(
          modifier === "emptyStringAsNull" || modifier === "falsyAsNull",
          "b.any already accepts undefined and null",
        );
      else assert(!inner.takesUndefined, `${inner.tsType} already takes undefined`);
    }
    assert(
      !(inner instanceof BytesType) || inner.canBe(modifier),
      'b.bytes can be absent if it is held: "borrowed", and .nullable if it is string: "asIs"',
    );
    this.inner = inner;
    this.modifier = modifier;
  }
  /** After `.nullable`: WebIDL's `optional T? x = null`. */
  get optional(): OptionalType {
    return this.modifier === "nullable" ? new OptionalType(this.inner, "nullable", true) : super.optional;
  }
  get isOmittable(): boolean {
    return this.#omittable;
  }
  get idlType(): string {
    const template = {
      optional: "WebCore::IDLOptional",
      nullable: "WebCore::IDLNullable",
      falsyAsNull: "Bun::Bindgen::IDLFalsyAsNull",
      emptyStringAsNull: "Bun::Bindgen::IDLEmptyStringAsNull",
      otherAsNull: "Bun::Bindgen::IDLOtherAsNull",
      ifPassed: "Bun::Bindgen::IDLIfPassed",
    }[this.modifier];
    return `${template}<${this.inner.idlType}>`;
  }
  get tsType(): string {
    if (this.modifier === "otherAsNull") return "any";
    const absent = this.modifier === "optional" || this.modifier === "ifPassed" ? "undefined" : "null | undefined";
    return `${this.inner.tsType} | ${absent}`;
  }
  /** `.falsyAsNull` takes the other falsy values too, which the table has no word for. */
  get parameterType(): ParameterType {
    if (this.modifier === "otherAsNull") return ignoringParameterType(this.inner.parameterType);
    const absent =
      this.modifier === "ifPassed" ? neverType : this.modifier === "optional" ? undefinedType : nullishType;
    const type = optionalParameterType(this.inner.parameterType, absent);
    const coerces = type.conversion !== "None" && type.conversion !== "Dictionary";
    return this.modifier === "falsyAsNull" && coerces ? { ...type, conversion: "ToPrimitive" } : type;
  }
  /** A null pointer stands for an argument that is not there. One that is `undefined` or `null` is for the host function. */
  get directForm(): DirectForm | null {
    const form = this.inner.directForm;
    return form?.value === "Value" && this.inner.nullRepresentation === "pointer"
      ? { ...form, value: "ValueOrEmpty" }
      : null;
  }
  get isReadInPlace(): boolean {
    return this.inner.isReadInPlace;
  }
  get resultType(): TypeSpec {
    return unionType(this.inner.resultType, this.modifier === "optional" ? undefinedType : primitiveType("Null"));
  }
  get takesUndefined(): boolean {
    return true;
  }
  get isOptional(): boolean {
    return true;
  }
  get refusalOutsideArgument(): string | null {
    return this.modifier === "ifPassed" ? ".ifPassed is only for an argument" : super.refusalOutsideArgument;
  }
  get conversionThrows(): boolean {
    return this.modifier === "otherAsNull" ? this.inner.tryConvertThrows : this.inner.conversionThrows;
  }
  get valueKinds(): ValueKinds {
    if (this.inner.valueKinds === "any" || !["optional", "nullable", "ifPassed"].includes(this.modifier)) return "any";
    return [...this.inner.valueKinds, "undefined", ...(this.modifier === "nullable" ? (["null"] as const) : [])];
  }
  get dependencies(): readonly Type[] {
    return [this.inner];
  }
  get convertsInPlace(): boolean {
    return this.inner.convertsInPlace;
  }
  get returnsValueUnchanged(): boolean {
    return this.inner.returnsValueUnchanged;
  }
  get passesValue(): boolean {
    return this.inner.passesValue;
  }
  cppPrepare(value: string): string | null {
    return this.inner.cppPrepare(value);
  }
  cppReadLast(target: string, value: string): string[] {
    return this.inner.cppReadLast(target, value);
  }
  #cppIsPresent(value: string): string {
    if (this.modifier === "otherAsNull") return this.inner.cppTakes(value);
    return {
      optional: `!${value}.isUndefined()`,
      nullable: `!${value}.isUndefinedOrNull()`,
      falsyAsNull: `${value}.toBoolean(globalObject)`,
      emptyStringAsNull: `!Bun::Bindgen::isUndefinedOrNullOrEmptyString(${value})`,
      ifPassed: `!${value}.isEmpty()`,
    }[this.modifier];
  }
  cppConvertInto(target: string, value: string, ctx: string, name: string, failure: string): string {
    // The `tryConvert` of `.otherAsNull` tests the value and converts it in one step.
    const convertsInOneStep = this.modifier === "otherAsNull" && !this.convertsInPlace;
    if (!this.conversionThrows || convertsInOneStep) return super.cppConvertInto(target, value, ctx, name, failure);
    const convert = (slot: string) => this.inner.cppConvertInto(slot, value, ctx, name, failure);
    const body = this.inner.nullRepresentation === "optional" ? cppEmplace(target, convert) : convert(target);
    const converted = `if (${this.#cppIsPresent(value)}) {\n${indent(body, 4)}\n}`;
    // Both are null when default-constructed. Of the rest, a pointer to a class instance is not.
    if (this.convertsInPlace || this.inner.nullRepresentation === "optional") return converted;
    return `${converted} else {\n    ${target} = ${this.inner.idlType}::nullValue();\n}`;
  }
  toCpp(value: unknown): string {
    return value == null ? `${this.idlType}::nullValue()` : this.inner.toCpp(value);
  }
  cppAssign(target: string, value: unknown): string {
    if (!this.convertsInPlace) return super.cppAssign(target, value);
    if (value == null) return "";
    const assign = (slot: string) => this.inner.cppAssign(slot, value);
    return this.inner.nullRepresentation === "optional" ? cppEmplace(target, assign) : assign(target);
  }
  toRust(value: unknown, scope: RustScope): string {
    return value == null ? "None" : `Some(${this.inner.toRust(value, scope)})`;
  }
  get elementTest() {
    return this.modifier === "nullable" ? this.inner.elementTest : null;
  }
  layout(): Layout {
    return this.inner.nullRepresentation === "optional"
      ? taggedUnionLayout([{ size: 1, align: 1 }, this.inner.layout()])
      : this.inner.layout();
  }
  rustExternType(scope: RustScope): string {
    return this.inner.nullRepresentation === "optional"
      ? `bindgen::extern_types::ExternOptional<${this.inner.rustExternType(scope)}>`
      : this.inner.rustExternType(scope);
  }
  rustType(scope: RustScope): string {
    return `Option<${this.inner.rustType(scope)}>`;
  }
  /** The body borrows a dictionary, `Option<&T>`, and takes over a string. */
  rustArgument(name: string): string {
    return this.inner instanceof DictionaryType ? `${name}.as_ref()` : super.rustArgument(name);
  }
  get bodyMayBorrow(): boolean {
    return this.inner.bodyMayBorrow;
  }
  rustFromExtern(expr: string, scope: RustScope): string {
    if (this.inner.nullRepresentation === "optional") {
      const inner = this.inner.rustFromExtern("value", scope);
      return inner === "value" ? `${expr}.get()` : `${expr}.get().map(|value| ${inner})`;
    }
    if (this.inner instanceof BytesType) return this.inner.rustFromExternOptional(expr);
    if (this.inner instanceof Utf8Type) return `${expr}.get_optional(heap)`;
    const isNull = this.inner.nullRepresentation === "emptyValue" ? "is_empty" : "is_null";
    return `if ${expr}.${isNull}() { None } else { Some(${this.inner.rustFromExtern(expr, scope)}) }`;
  }
  rustResultFieldType(scope: RustScope): string {
    return `Option<${this.inner.rustResultFieldType(scope)}>`;
  }
  rustToJS(value: string, scope: RustScope): string {
    const none = this.modifier === "optional" ? "UNDEFINED" : "NULL";
    return `match ${value} { Some(value) => ${this.inner.rustToJS("value", scope)}, None => Ok(bindgen::JsLocal::${none}) }`;
  }
}

export class WithValueType extends Type {
  readonly inner: Type;
  constructor(inner: Type) {
    super();
    assert(!(inner instanceof WithValueType), "already .withValue");
    assert(!inner.passesValue, ".withValue: b.bytes already passes the argument");
    assert(!inner.returnsValueUnchanged, ".withValue: the type is the argument itself");
    assert(!isIfPassed(inner), ".ifPassed has no argument to give when it is absent");
    this.inner = inner;
  }
  get idlType(): string {
    return this.inner.idlType;
  }
  get tsType(): string {
    return this.inner.tsType;
  }
  get parameterType(): ParameterType {
    return this.inner.parameterType;
  }
  get canRefuse(): boolean {
    return this.inner.canRefuse;
  }
  get passesValue(): boolean {
    return true;
  }
  get holdsJSValue(): boolean {
    return true;
  }
  get takesUndefined(): boolean {
    return this.inner.takesUndefined;
  }
  get isOptional(): boolean {
    return this.inner.isOptional;
  }
  get valueKinds(): ValueKinds {
    return this.inner.valueKinds;
  }
  get refuses(): string | null {
    return this.inner.refuses;
  }
  get conversionThrows(): boolean {
    return this.inner.conversionThrows;
  }
  get rustFromExternThrows(): boolean {
    return this.inner.rustFromExternThrows;
  }
  get dependencies(): readonly Type[] {
    return [this.inner];
  }
  get convertsInPlace(): boolean {
    return this.inner.convertsInPlace;
  }
  cppConvert(value: string, ctx: string): string {
    return this.inner.cppConvert(value, ctx);
  }
  cppConvertInto(target: string, value: string, ctx: string, name: string, failure: string): string {
    return this.inner.cppConvertInto(target, value, ctx, name, failure);
  }
  cppReadLast(target: string, value: string): string[] {
    return this.inner.cppReadLast(target, value);
  }
  layout(): Layout {
    return structLayout([this.inner.layout(), { size: 8, align: 8 }]);
  }
  rustExternType(scope: RustScope): string {
    return `bindgen::extern_types::ExternWithValue<${this.inner.rustExternType(scope)}>`;
  }
  rustType(scope: RustScope): string {
    return `(${this.inner.rustType(scope)}, bindgen::JsLocal<'a>)`;
  }
  rustFromExtern(expr: string, scope: RustScope): string {
    return `(${this.inner.rustFromExtern(`${expr}.converted`, scope)}, bindgen::JsLocal::from_extern(${expr}.value, heap))`;
  }
}

export const isIfPassed = (type: Type) => type instanceof OptionalType && type.modifier === "ifPassed";

/** Not a type of its own: marks an argument or member whose absence has a value. */
export class DefaultType extends Type {
  readonly inner: Type;
  readonly value: unknown;
  /** `null` also takes the default. */
  readonly onNull: boolean;
  constructor(inner: Type, value: unknown) {
    super();
    assert(!(inner instanceof DefaultType), "already has a default");
    assert(!(inner instanceof WithValueType), "put .withValue last");
    if (inner instanceof OptionalType) {
      assert(inner.modifier === "nullable", ".default() follows a type or .nullable");
      this.inner = inner.inner;
      this.onNull = true;
    } else {
      this.inner = inner;
      this.onNull = false;
    }
    this.value = value;
    // For what it asserts about `value`.
    this.inner.cppAssign("", value);
  }
  get idlType(): string {
    return this.inner.idlType;
  }
  get tsType(): string {
    return `${this.inner.tsType} | ${this.onNull ? "null | undefined" : "undefined"}`;
  }
  get parameterType(): ParameterType {
    return optionalParameterType(this.inner.parameterType, this.onNull ? nullishType : undefinedType);
  }
  /** Of an argument that is there. */
  get directForm(): DirectForm | null {
    return this.inner.directForm;
  }
  get isReadInPlace(): boolean {
    return this.inner.isReadInPlace;
  }
  get takesUndefined(): boolean {
    return true;
  }
  get isOptional(): boolean {
    return true;
  }
  get refusalOutsideArgument(): string | null {
    return this.inner.refusalOutsideArgument;
  }
  rustArgument(name: string): string {
    return this.inner.rustArgument(name);
  }
  get conversionThrows(): boolean {
    return this.inner.conversionThrows;
  }
  get dependencies(): readonly Type[] {
    return [this.inner];
  }
  toCpp(value: unknown): string {
    return this.inner.toCpp(value);
  }
  toRust(value: unknown, scope: RustScope): string {
    return this.inner.toRust(value, scope);
  }
  get hasRustDefault(): boolean {
    return this.inner.hasRustDefault;
  }
  get valueKinds(): ValueKinds {
    if (this.inner.valueKinds === "any") return "any";
    return [...this.inner.valueKinds, "undefined", ...(this.onNull ? (["null"] as const) : [])];
  }
  cppPrepare(value: string): string | null {
    return this.inner.cppPrepare(value);
  }
  /** The default is what the dictionary makes of `undefined` and `null`. */
  get isEmptyDictionary(): boolean {
    return (
      this.inner instanceof DictionaryType &&
      !!(this.inner.nonObjectAsEmpty || (this.inner.options.webidl && this.inner.hasDefault)) &&
      Object.keys(this.value as object).length === 0
    );
  }
  private cppIsAbsent(value: string): string {
    return `${value}.${this.onNull ? "isUndefinedOrNull" : "isUndefined"}()`;
  }
  cppConvert(value: string, ctx: string): string {
    return `${this.cppIsAbsent(value)} ? ${this.toCpp(this.value)} : ${this.inner.cppConvert(value, ctx)}`;
  }
  get convertsInPlace(): boolean {
    return this.inner.convertsInPlace;
  }
  cppConvertInto(target: string, value: string, ctx: string, name: string, failure: string): string {
    if (!this.conversionThrows) return super.cppConvertInto(target, value, ctx, name, failure);
    if (outOfLine.convert && this.isEmptyDictionary)
      return this.inner.cppConvertInto(target, value, ctx, name, failure);
    return `if (${this.cppIsAbsent(value)}) {
${indent(this.cppAssign(target, this.value), 4)}
} else {
${indent(this.inner.cppConvertInto(target, value, ctx, name, failure), 4)}
}`;
  }
  cppAssign(target: string, value: unknown): string {
    return this.inner.cppAssign(target, value);
  }
  layout(): Layout {
    return this.inner.layout();
  }
  rustExternType(scope: RustScope): string {
    return this.inner.rustExternType(scope);
  }
  rustType(scope: RustScope): string {
    return this.inner.rustType(scope);
  }
  rustFromExtern(expr: string, scope: RustScope): string {
    return this.inner.rustFromExtern(expr, scope);
  }
}

/** Every argument from its position on: `&'a [T]`, where they are in the frame of the caller. */
export class RestType extends Type {
  readonly element: Type;
  constructor(element: Type) {
    super();
    this.element = element;
    if (this.convertsElements) markAsElement(element);
  }
  /** Else they are passed as they are. */
  get convertsElements(): boolean {
    return !(this.element instanceof AnyType || this.element.constructor === LocalStringType);
  }
  get holdsJSValue(): boolean {
    return true;
  }
  get idlType(): string {
    throw new TypeError("b.rest is only the last argument of a function");
  }
  get tsType(): string {
    const element = this.element.tsType;
    return /^[\w.$]+$/.test(element) ? `${element}[]` : `(${element})[]`;
  }
  get parameterType(): ParameterType {
    return { ...this.element.parameterType, mode: "Rest" };
  }
  get directForm(): DirectForm | null {
    const elements = this.element instanceof UnionType ? this.element.dependencies : [this.element];
    const forms = elements.map(it => it.directForm);
    if (forms.some(form => form?.value !== "Value")) return null;
    const type = forms.length === 1 ? forms[0]!.type : unionType(...forms.map(form => form!.type));
    return { value: "RestOfValues", type, cppType: "const JSC::EncodedJSValue*, size_t" };
  }
  get isReadInPlace(): boolean {
    return this.element.isReadInPlace;
  }
  get isOptional(): boolean {
    return true;
  }
  get takesUndefined(): boolean {
    return true;
  }
  get dependencies(): readonly Type[] {
    return [this.element];
  }
  layout(): Layout {
    return { size: 16, align: 8 };
  }
  rustExternType(): string {
    throw new TypeError("b.rest is passed as a pointer and a count");
  }
  rustType(scope: RustScope): string {
    const element = this.element.rustType(scope);
    return this.convertsElements ? `bindgen::JsList<'a, ${element}>` : `&'a [${element}]`;
  }
  rustFromExtern(expr: string): string {
    assert(this.element.elementTest, `b.rest: a JS value cannot stand for a converted ${this.element.tsType}`);
    if (this.convertsElements) return `bindgen::JsList::from_arguments(${expr}, ${expr}_count, heap)`;
    const known = this.element instanceof LocalStringType ? "bun_jsc::JSString" : "JSValue";
    return `bindgen::rest_from_extern::<${known}>(${expr}, ${expr}_count, heap)`;
  }
}

export class ArrayType extends Type {
  get rustIsCopy(): boolean {
    return false;
  }
  readonly element: Type;
  constructor(element: Type) {
    super();
    assert(!(element instanceof DefaultType), "an element of an array is never absent, so it has no default");
    assert(
      !(withoutModifiers(element) instanceof RangeType),
      "the converter of a range takes no context, which is what names an element",
    );
    refuseOutsideArgument(element);
    assert(
      !element.borrowsCell,
      "an instance that Rust takes as &T cannot be in an array or a dictionary: only an argument's slot in the frame keeps it alive",
    );
    assert(
      !element.borrowsHeap,
      "the bytes of a buffer are only for an argument: they are read after everything else is converted",
    );
    assert(!(element instanceof UnitType), "an array of nothing but null");
    assert(
      !element.holdsJSValue,
      "an array is a Vec, where the GC does not see JS values: take or return b.any and go through the array in Rust",
    );
    this.element = element;
    const markConvertedByValue = (type: Type) => {
      if (type instanceof DictionaryType) type.convertedByValue = true;
      else if (!(type instanceof NamedType)) type.dependencies.forEach(markConvertedByValue);
    };
    markConvertedByValue(element);
  }
  get idlType(): string {
    assert(
      !this.element.borrowsFrame,
      "an array argument cannot hold borrowed views; use b.string or b.string.utf8.owned",
    );
    return `Bun::Bindgen::IDLArray<${this.element.idlType}>`;
  }
  get tsType(): string {
    return `(${this.element.tsType})[]`;
  }
  get valueKinds(): ValueKinds {
    return ["array"];
  }
  /** Whatever its elements are: each is converted as the array is iterated. */
  get parameterType(): ParameterType {
    return strictType(instanceType("Array"));
  }
  get resultType(): TypeSpec {
    return { type: "Instance", class: "Array", contents: { element: this.element.resultType }, freshness: "Yes" };
  }
  get canRefuse(): boolean {
    return this.element.conversionThrows;
  }
  get dependencies(): readonly Type[] {
    return [this.element];
  }
  getHeaders(out: Set<string>): void {
    out.add("Bindgen/ExternVectorTraits.h");
    super.getHeaders(out);
  }
  layout(): Layout {
    return { size: 16, align: 8 };
  }
  rustExternType(scope: RustScope): string {
    return `bindgen::extern_types::ExternVector<${this.element.rustExternType(scope)}>`;
  }
  rustType(scope: RustScope): string {
    return `Vec<${this.element.rustType(scope)}>`;
  }
  rustFromExtern(expr: string, scope: RustScope): string {
    const element = this.element.rustFromExtern("value", scope);
    return element === "value" ? `${expr}.into_vec()` : `${expr}.into_vec_with(|value| ${element})`;
  }
  rustResultFieldType(scope: RustScope): string {
    return `Vec<${this.element.rustResultFieldType(scope)}>`;
  }
  rustToJS(value: string, scope: RustScope): string {
    return (
      this.element.rustArrayToJS(value) ??
      `bindgen::to_js::array(heap, ${value}, |heap, value| ${this.element.rustToJS("value", scope)})`
    );
  }
}

/** An object with a property for each pair of a key, in UTF-8, and a value. */
export class RecordResultType extends ResultType {
  readonly refusal = "b.record is a result";
  readonly value: Type;
  constructor(value: Type) {
    super();
    assert(
      !value.holdsJSValue,
      "the pairs of a record can be a Vec, where the GC does not see JS values: return b.any and make it with to_js::record",
    );
    this.value = value;
  }
  get tsType(): string {
    return `Record<string, ${this.value.tsType}>`;
  }
  /** With no JS value in it, it is new objects, new arrays and primitives. Plain data inherits from Object.prototype and Array.prototype. */
  get resultType(): TypeSpec {
    return this.makesObjectWithoutPrototype ? { type: "Object", freshness: "Yes" } : { type: "PlainData" };
  }
  get dependencies(): readonly Type[] {
    return [this.value];
  }
  rustType(): never {
    throw new TypeError("b.record has no Rust type to name, so it is not a member or an alternative");
  }
  rustToJS(value: string, scope: RustScope): string {
    return `bindgen::to_js::record(heap, ${value}, |heap, value| ${this.value.rustToJS("value", scope)})`;
  }
}

// ───────────────────────────── named types ─────────────────────────────

const anyScope: RustScope = { rustModule: "", crate: "" };

function markAsElement(type: Type) {
  if (type instanceof UnionType || type instanceof EnumerationType) type.isElement = true;
  if (!(type instanceof ClassType)) type.dependencies.forEach(markAsElement);
}

/** What an iterable yields, or the own enumerable properties of an object, in a cell that JavaScript does not see. */
export class ListType extends Type {
  readonly key: Type | null;
  readonly element: Type;
  readonly #isFrozen: boolean;
  constructor(key: Type | null, element: Type, isFrozen = false) {
    super();
    this.key = key;
    this.element = element;
    this.#isFrozen = isFrozen;
    markAsElement(element);
  }
  get idlType(): string {
    assert(
      this.element.elementTest && (!this.key || this.key.elementTest),
      `${this.tsType}: the elements are held as JS values. A string is b.DOMString itself, .impl or .atom. Take a dictionary that holds JS values as b.object, and convert it in Rust (fromJS)`,
    );
    return this.key
      ? `Bun::Bindgen::IDLRecordList<${this.key.idlType}, ${this.element.idlType}>`
      : `Bun::Bindgen::IDLSequenceList<${this.element.idlType}>`;
  }
  get tsType(): string {
    return this.key ? `Record<string, ${this.element.tsType}>` : `Iterable<${this.element.tsType}>`;
  }
  get parameterType(): ParameterType {
    return { ...strictType({ type: "Object" }), conversion: "Dictionary" };
  }
  get resultType(): TypeSpec {
    return { type: "Instance", class: "Array", contents: { element: this.element.resultType }, freshness: "Yes" };
  }
  get refuses(): string {
    return this.key ? nonObjects : "what is not iterable";
  }
  get holdsJSValue(): boolean {
    return true;
  }
  get nullRepresentation() {
    return "pointer" as const;
  }
  get dependencies(): readonly Type[] {
    return [...(this.key ? [this.key] : []), this.element];
  }
  get elementTest() {
    return (value: string) => `${value}.is_cell() && ${value}.js_type() == bun_jsc::JSType::JSCellButterfly`;
  }
  get unionCategory(): UnionCategory {
    return this.key ? "dictionary" : "sequence";
  }
  /** A null pointer is an empty list. */
  toCpp(value: unknown): string {
    assert(Object.keys(value as object).length === 0, "the default of a list is empty");
    return "nullptr";
  }
  get hasRustDefault(): boolean {
    return false;
  }
  layout(): Layout {
    return { size: 8, align: 8 };
  }
  rustExternType(): string {
    return "*mut core::ffi::c_void";
  }
  rustType(scope: RustScope): string {
    return this.key
      ? `bindgen::JsRecord<'a, ${this.key.rustType(scope)}, ${this.element.rustType(scope)}>`
      : `bindgen::JsList<'a, ${this.element.rustType(scope)}>`;
  }
  rustResultFieldType(scope: RustScope): string {
    return jsArrayType.rustType();
  }
  rustFromExtern(expr: string): string {
    return `bindgen::${this.key ? "JsRecord" : "JsList"}::from_cell(${expr}, heap)`;
  }
  /** Any `IntoIterator`. */
  rustToJS(value: string, scope: RustScope): string {
    assert(!this.key, "b.record is what returns one");
    const converted = this.element.rustToJS("value", scope);
    return `bindgen::to_js::${this.#isFrozen ? "frozen_" : ""}sequence(heap, ${value}, |${/\bheap\b/.test(converted) ? "heap" : "_"}, value| ${converted})`;
  }
}

/** A `sequence<T>` of what holds no JS value. */
export class SequenceType extends ArrayType {
  get bodyMayBorrow(): boolean {
    return true;
  }
  get idlType(): string {
    return super.idlType.replace("IDLArray", "IDLSequenceVector");
  }
  get tsType(): string {
    return `Iterable<${this.element.tsType}>`;
  }
  get valueKinds(): ValueKinds {
    return "any";
  }
  get parameterType(): ParameterType {
    return { ...strictType({ type: "Object" }), conversion: "Dictionary" };
  }
  get refuses(): string {
    return "what is not iterable";
  }
  get unionCategory(): UnionCategory {
    return "sequence";
  }
  toCpp(value: unknown): string {
    assert(Array.isArray(value) && value.length === 0, "the default of a sequence is empty");
    return "{}";
  }
  toRust(): string {
    return "Vec::new()";
  }
}

/** An instance of a class that is written in C++. */
export class NativeInstanceType extends LocalType {
  readonly #header: string;
  static readonly #kinds = new Map<string, JSClass>();
  constructor(name: string, cpp: string, header: string) {
    const kind = NativeInstanceType.#kinds.getOrInsert(cpp, { cpp });
    super(`Bun::Bindgen::IDLRawBuffer<${cpp}, true>`, name, "bun_jsc::JSObject", [kind], null, { type: "Object" });
    this.#header = header;
  }
  get directForm(): null {
    return null;
  }
  get canRefuse(): boolean {
    return true;
  }
  getHeaders(out: Set<string>): void {
    out.add(this.#header);
  }
}

const typedArrayElements = {
  Int8Array: "i8",
  Uint8Array: "u8",
  Uint8ClampedArray: "u8",
  Int16Array: "i16",
  Uint16Array: "u16",
  Int32Array: "i32",
  Uint32Array: "u32",
  Float16Array: "u16",
  Float32Array: "f32",
  Float64Array: "f64",
  BigInt64Array: "i64",
  BigUint64Array: "u64",
  ArrayBufferView: "u8",
  DataView: "u8",
  ArrayBuffer: "u8",
} as const;

/** One kind of buffer or view. */
export class TypedArrayType extends BufferSourceType {
  readonly #name: keyof typeof typedArrayElements;
  readonly #allowShared: boolean;
  static readonly #kinds = new Map<string, JSClass>();
  constructor(name: keyof typeof typedArrayElements, allowShared = false) {
    super(allowShared);
    assert(name in typedArrayElements, `${name} is none of ${Object.keys(typedArrayElements).join(", ")}`);
    this.#name = name;
    this.#allowShared = allowShared;
  }
  get idlType(): string {
    return `Bun::Bindgen::IDLRawBuffer<JSC::JS${this.#name}, ${this.#allowShared}>`;
  }
  get tsType(): string {
    return this.#name;
  }
  get valueKinds(): ValueKinds {
    return [TypedArrayType.#kinds.getOrInsert(this.#name, { cpp: `JSC::JS${this.#name}` })];
  }
  get parameterType(): ParameterType {
    return this.#name === "ArrayBufferView" ? super.parameterType : strictType(instanceType(this.#name));
  }
  get allowShared(): TypedArrayType {
    return new TypedArrayType(this.#name, true);
  }
  get elementTest() {
    return (value: string) =>
      this.#name === "ArrayBufferView"
        ? `${value}.is_cell() && ${value}.js_type().is_array_buffer_like() && ${value}.js_type() != bun_jsc::JSType::ArrayBuffer`
        : `${value}.is_cell() && ${value}.js_type() == bun_jsc::JSType::${this.#name}`;
  }
  rustType(): string {
    return `bindgen::JsLocal<'a, bindgen::TypedArray<${typedArrayElements[this.#name]}>>`;
  }
}

export abstract class NamedType extends Type {
  /** A `bindgen::JsList` holds it. */
  isElement = false;
  /** The name it is exported under, and where. Set when the generator finds it among a file's exports. */
  name = "";
  origin: Origin | null = null;
  /** Reachable from an argument or `fromJS` / from a return type. Set by the generator. */
  accepted = false;
  returned = false;
  get cpp(): string {
    return `Bun::Bindgen::Generated::${this.name}`;
  }
  getHeaders(out: Set<string>): void {
    assert(this.origin, `${this.constructor.name}: used but not exported from a .bind.ts file`);
    out.add(`Generated${this.origin.namespace}.h`);
  }
  protected path(scope: RustScope, name: string): string {
    assert(this.origin, `${this.constructor.name}: used but not exported from a .bind.ts file`);
    assert(
      this.origin.crate === scope.crate,
      `${this.name} is declared in ${this.origin.crate} and used in ${scope.crate}: what is generated is private to its crate`,
    );
    if (this.origin.rustModule !== scope.rustModule) return `super::${this.origin.rustModule}::${name}`;
    return name;
  }
  rustType(scope: RustScope): string {
    return this.path(scope, this.name) + (this.needsLifetime ? "<'a>" : "");
  }
  get tsType(): string {
    return this.name;
  }
}

/** A record names the variants, for values that make no identifier or the same one. */
export type EnumerationValues =
  readonly (string | readonly string[])[] | Readonly<Record<string, string | readonly string[]>>;

export class EnumerationType extends NamedType {
  /** `spellings[i]` all parse to variant `i`; the first is the canonical one. */
  readonly spellings: readonly (readonly string[])[];
  /** Index of the first canonical spelling in `Tables::enumerationValues`. Set by the generator. */
  firstEnumerationValueIndex = -1;
  /** Where it is in `Tables::enumerationSpellings`, if it is. Set by the generator. */
  spellingsOffset = -1;
  /** Its file has interfaces or WebIDL dictionaries, for which `ToString` comes first. Set by the generator. */
  isWebIDL = false;
  readonly variants: readonly string[];
  constructor(values: EnumerationValues) {
    super();
    const spellings: readonly (string | readonly string[])[] = Array.isArray(values) ? values : Object.values(values);
    assert(spellings.length > 0, "an enumeration needs at least one value");
    this.spellings = spellings.map(value => (typeof value === "string" ? [value] : value));
    this.variants = Array.isArray(values)
      ? this.spellings.map(([canonical]) =>
          pascalCase(canonical.replace(/[A-Z]{2,}/g, capitals => capitals.toLowerCase())),
        )
      : Object.keys(values);
    const all = this.spellings.flat();
    assert(new Set(all).size === all.length, `a value is listed twice: ${all.join(", ")}`);
    assert(
      new Set(this.variants).size === this.variants.length,
      `two values make the same identifier: ${this.variants.join(", ")}`,
    );
    for (const variant of this.variants) assert(/^[A-Z]/.test(rustIdent(variant)), `${variant} is not an identifier`);
  }
  get valueKinds(): ValueKinds {
    return ["string"];
  }
  get parameterType(): ParameterType {
    const literals: TypeSpec = { type: "StringLiterals", values: this.spellings.flat() };
    if (this.isWebIDL) return convertingType(literals, "ToString", stringType);
    return strictType(unionType(literals, instanceType("String")));
  }
  /** A String object whose characters are none of the values. */
  get canRefuse(): boolean {
    return true;
  }
  get resultType(): TypeSpec {
    return { type: "StringLiterals", values: this.spellings.map(([canonical]) => canonical) };
  }
  get insteadOfOtherAsNull(): string {
    return "b.string.allowStringObject.otherAsNull takes every string";
  }
  get idlType(): string {
    return `WebCore::IDLEnumeration<${this.cpp}>`;
  }
  get tsType(): string {
    return this.spellings
      .flat()
      .map(value => JSON.stringify(value))
      .join(" | ");
  }
  toCpp(value: unknown): string {
    const index = this.spellings.findIndex(spellings => spellings.includes(value as string));
    assert(index >= 0, `${util.inspect(value)} is not one of ${this.tsType}`);
    return `${this.cpp}::${this.variants[index]}`;
  }
  toRust(value: unknown, scope: RustScope): string {
    const index = this.spellings.findIndex(spellings => spellings.includes(value as string));
    return `${this.path(scope, this.name)}::${this.variants[index]}`;
  }
  get elementTest() {
    return (value: string) => `${value}.is_number()`;
  }
  get unionCategory(): UnionCategory {
    return "string";
  }
  layout(): Layout {
    return { size: 4, align: 4 };
  }
  rustExternType(scope: RustScope): string {
    return this.path(scope, this.name);
  }
  rustToJS(value: string, scope: RustScope): string {
    return `${value}.to_js(heap)`;
  }
}

export interface MemberOptions {
  type: Type;
  /** Name of the field in the Rust struct, and in the C++ one that mirrors it. Defaults to the JS name in snake_case. */
  rustName?: string;
  /** Other JS names, tried in order while the value is `undefined`. */
  altNames?: readonly string[];
  /** As a function's `expected`, for this member. */
  expected?: readonly string[] | string;
}

export class Member {
  readonly names: readonly string[];
  /** Of the field in the generated C++ struct and, keywords aside, in the Rust one. */
  readonly fieldName: string;
  readonly type: Type;
  readonly expected?: readonly string[] | string;
  constructor(name: string, spec: Type | MemberOptions) {
    const options: MemberOptions = spec instanceof Type ? { type: spec } : spec;
    this.names = [name, ...(options.altNames ?? [])];
    for (const name of this.names)
      assert(/^[A-Za-z_$][\w$]*$/.test(name), `${name}: a member is named by an identifier`);
    this.fieldName = options.rustName ?? snakeCase(name);
    assert(/^[a-z_][a-z0-9_]*$/.test(this.fieldName), `${this.fieldName}: rustName is written in snake_case`);
    assert(!cppKeywords.has(this.fieldName), `${this.fieldName} is a C++ keyword: name the field with rustName`);
    this.type = options.type;
    assert(options.expected === undefined || options.expected.length > 0, `expected: ${name} expects nothing`);
    if (options.expected !== undefined) refuseExpectedOfRange(name, options.type);
    this.expected = options.expected;
  }
  get name(): string {
    return this.names[0];
  }
  get rustName(): string {
    return rustIdent(this.fieldName);
  }
}

export interface DictionaryOptions {
  /** WebIDL's rules: members are read in lexicographic order, from any object, and `undefined` and `null` are `{}`. */
  webidl?: boolean;
  /** With `webidl`: what a script has put on `Object.prototype` is not read, as it is not a script that passes this. */
  fromHost?: boolean;
  /** With `webidl`: the members of that one come first. */
  extends?: DictionaryType;
  /** Also generate `Name::from_js`, for Rust that holds a JS value and no typed signature. */
  fromJS?: boolean;
  /** Generate `into_js(heap)`, though no function returns it. */
  intoJS?: boolean;
  /** An array is read like any other object, not refused. */
  allowArray?: boolean;
  /**
   * A value that is not an object gives every member its default. With `"typeof"` so does a function: Node's
   * `if (typeof options !== "object") options = null`.
   */
  nonObjectAsEmpty?: boolean | "typeof";
  /** As a result, the object has no prototype. */
  nullPrototype?: boolean;
  /** What an error calls the dictionary: `"options"` makes a member `options.level`, and `""` makes it `level`. Defaults to the name of the type. */
  reportedAs?: string;
}

export class DictionaryType extends NamedType {
  readonly options: DictionaryOptions;
  readonly members: readonly Member[];
  /** Index in `Tables::memberNames` of the first name read, and of the first name written. Set by the generator. */
  firstMemberNameIndex = -1;
  firstReturnedMemberNameIndex = -1;
  /** Among the dictionaries that are returned. */
  returnedIndex = -1;
  /** An element of an array: everywhere else it is converted in place. */
  convertedByValue = false;
  constructor(members: Record<string, Type | MemberOptions>, options: DictionaryOptions = {}) {
    super();
    this.options = options;
    const own = Object.entries(members).map(([name, spec]) => new Member(name, spec));
    assert(options.webidl || !options.extends, "extends is for a dictionary with webidl");
    this.members = options.webidl
      ? [...(options.extends?.members ?? []), ...own.toSorted((a, b) => (a.name < b.name ? -1 : 1))]
      : own;
    assert(this.members.length > 0, "a dictionary needs at least one member");
    assertDistinct(
      this.members.map(member => member.fieldName),
      "fields",
    );
    for (const { name, type } of this.members) {
      refuseOutsideArgument(type, name);
      assert(!(type instanceof VariadicType), `${name}: .variadic is only for the last argument`);
    }
    assert(
      !this.borrowsCell,
      "an instance that Rust takes as &T cannot be in an array or a dictionary: only an argument's slot in the frame keeps it alive",
    );
    assert(
      !this.nonObjectAsEmpty || this.hasDefault,
      "nonObjectAsEmpty: every member must be optional or have a default",
    );
    assert(
      !this.borrowsHeap,
      "the bytes of a buffer are only for an argument: they are read after everything else is converted",
    );
    assert(
      !this.fromJS || !this.borrowsFrame,
      "from_js outlives the frame b.string.utf8 borrows from; use b.string or b.string.utf8.owned",
    );
  }
  /** One that is only returned owns its strings, so nothing but a JS value in it has a lifetime. */
  get needsLifetime(): boolean {
    return this.accepted ? super.needsLifetime : this.holdsJSValue;
  }
  get fromJS(): boolean {
    return !!this.options.fromJS;
  }
  get insteadOfOtherAsNull(): string | null {
    return this.allowArray ? null : "give the dictionary allowArray";
  }
  get allowArray(): boolean {
    return !!this.options.allowArray || !!this.options.webidl;
  }
  get nonObjectAsEmpty(): boolean | "typeof" {
    return this.options.nonObjectAsEmpty ?? false;
  }
  get refuses(): string | null {
    return this.nonObjectAsEmpty ? null : nonObjects;
  }
  get borrowedByBody(): boolean {
    return true;
  }
  get nullPrototype(): boolean {
    return !!this.options.nullPrototype;
  }
  get makesObjectWithoutPrototype(): boolean {
    return this.nullPrototype || super.makesObjectWithoutPrototype;
  }
  get idlType(): string {
    return `WebCore::IDLDictionary<${this.cpp}>`;
  }
  /** Nothing is read of what `nonObjectAsEmpty` takes. */
  get parameterType(): ParameterType {
    const accepted = unionType(
      this.nonObjectAsEmpty ? anyPrimitiveType : neverType,
      this.nonObjectAsEmpty === "typeof" ? { type: "Function" } : neverType,
    );
    return { ...convertingType(accepted, "Dictionary", unionType(accepted, { type: "Object" })), members: this.names };
  }
  /** With no JS value in it, it is new objects, new arrays and primitives. Plain data inherits from Object.prototype and Array.prototype. Otherwise it is still a new ordinary object: `to_js::object`, `to_js::null_prototype_object`. */
  get resultType(): TypeSpec {
    return this.holdsJSValue || this.makesObjectWithoutPrototype
      ? { type: "Instance", class: "Object", freshness: "Unaliased" }
      : { type: "PlainData" };
  }
  get dependencies(): readonly Type[] {
    return this.members.map(member => member.type);
  }
  get convertsInPlace(): boolean {
    return true;
  }
  cppConvertInto(target: string, value: string, ctx: string, name: string, failure: string): string {
    return cppReturnIfFailed(
      `Bun::Bindgen::convertDictionaryInto(*globalObject, ${value}, ${target}, ${ctx})`,
      failure,
    );
  }
  get reportedAs(): string {
    return this.options.reportedAs ?? this.name;
  }
  /** Every JS name read, in order. */
  get names(): string[] {
    return this.members.flatMap(member => member.names);
  }
  cppAssign(target: string, value: unknown): string {
    assert(
      typeof value === "object" && value !== null,
      `the default of a dictionary is an object, not ${util.inspect(value)}`,
    );
    const given = value as Record<string, unknown>;
    for (const key of Object.keys(given))
      assert(
        this.members.some(m => m.name === key),
        `unexpected key: ${key}`,
      );
    const fields = this.members.map(member => {
      let field: unknown;
      if (Object.hasOwn(given, member.name)) field = given[member.name];
      else if (member.type instanceof DefaultType) field = member.type.value;
      else assert(member.type.takesUndefined, `missing key: ${member.name}`);
      return member.type.cppAssign(`${target}.${member.fieldName}`, field);
    });
    return fields.filter(text => text.length > 0).join("\n");
  }
  /** clippy refuses `&` of a small `Copy` type, and a large one by value. */
  get rustIsCopy(): boolean {
    return false;
  }
  /** Every member can be absent. */
  get hasDefault(): boolean {
    return this.members.every(member => this.canLack(member));
  }
  /** In WebIDL a nullable member can be required. */
  canLack({ type }: Member): boolean {
    return this.options.webidl ? type.isOmittable : type.takesUndefined;
  }
  toRust(value: unknown, scope: RustScope): string {
    const given = value as Record<string, unknown>;
    const fields = this.members.map(member => {
      const field = member.type instanceof DefaultType ? member.type.value : undefined;
      return `${member.rustName}: ${member.type.toRust(Object.hasOwn(given, member.name) ? given[member.name] : field, scope)}`;
    });
    return `${this.path(scope, this.name)} { ${fields.join(", ")} }`;
  }
  get unionCategory(): UnionCategory {
    return "dictionary";
  }
  layout(): Layout {
    return structLayout(this.members.map(member => member.type.layout()));
  }
  rustExternType(scope: RustScope): string {
    return this.path(scope, `Extern${this.name}`);
  }
  rustFromExtern(expr: string, scope: RustScope): string {
    return `${this.path(scope, this.name)}::from_extern(&${expr}${this.needsLifetime ? ", heap" : ""})`;
  }
  rustToJS(value: string, scope: RustScope): string {
    return `${value}.into_js(heap)`;
  }
}

/** A value goes to the first alternative, in written order, that takes its kind. */
export class UnionType extends NamedType {
  readonly alternatives: readonly { name: string; variant: string; type: Type }[];
  readonly isWebIDL: boolean;
  constructor(alternatives: Record<string, Type>, { webidl = false } = {}) {
    super();
    this.isWebIDL = webidl;
    this.alternatives = Object.entries(alternatives).map(([name, type]) => ({ name, variant: pascalCase(name), type }));
    assert(this.alternatives.length > 0, "a union needs at least one alternative");
    assertDistinct(
      this.alternatives.map(alternative => alternative.variant),
      "variants",
    );
    assert(
      !this.borrowsHeap,
      "the bytes of a buffer are only for an argument: they are read after everything else is converted",
    );
    for (const { name, type } of this.alternatives) {
      assert(!(type instanceof UnionType), `${name}: list the alternatives of the other union here`);
      assert(
        !(type instanceof OptionalType),
        `${name}: add ${type instanceof OptionalType && type.modifier === "otherAsNull" ? "ignored: b.any" : "b.null"} as an alternative`,
      );
      assert(!(type instanceof DefaultType), `${name}: put .default() on the union`);
      refuseOutsideArgument(type, name);
      assert(!(type instanceof VariadicType), `${name}: .variadic is only for the last argument`);
      assert(/^[a-z][A-Za-z0-9]*$/.test(name), `${name}: an alternative is named in camelCase`);
      assert(name !== "tag", "tag: the generated struct has a member of that name");
      assert(!cppKeywords.has(name), `${name} is a C++ keyword, and JavaScript never sees the name: pick another`);
      assert(
        !(type instanceof RangeType) || webidl,
        `${name}: the converter of a range takes no context, which is what names an alternative`,
      );
    }
    // What it refers to may not be declared yet.
    if (webidl) return;
    const chosen = new Set([...this.alternativesByKind.values()].flat());
    this.alternatives.forEach(({ name }, i) =>
      assert(
        chosen.has(i),
        `${name} is never chosen: the alternatives before it take every value it would. Move it earlier or remove it`,
      ),
    );
  }
  /** As for a dictionary. */
  get needsLifetime(): boolean {
    return this.accepted ? super.needsLifetime : this.holdsJSValue;
  }
  get bodyMayBorrow(): boolean {
    return this.isWebIDL && !this.rustIsCopy;
  }
  get alternativesByKind() {
    return (this.isWebIDL ? webAlternativesByKind : alternativesByKind)(this.alternatives.map(a => a.type));
  }
  get valueKinds(): ValueKinds {
    const kinds = distinguishingKinds(this.alternatives.map(a => a.type)).filter(kind => kind !== "other");
    return this.alternatives.some(a => a.type.valueKinds === "any") ? "any" : kinds;
  }
  get parameterType(): ParameterType {
    if (this.isWebIDL) return { ...strictType({ type: "Anything" }), conversion: "Dictionary" };
    const alternatives = this.alternatives.map(a => a.type.parameterType);
    const taken = unionType(...alternatives.map(type => type.accepted));
    const accepted = this.#convertsPrimitivesAlone
      ? unionType(taken, withoutPrimitives(anyPrimitiveType, taken))
      : taken;
    const converting = alternatives.filter(
      type => type.conversion === "Dictionary" || (type.conversion !== "None" && !this.#convertsPrimitivesAlone),
    );
    assert(converting.length <= 1, `${this.tsType}: two alternatives convert what no other takes`);
    if (converting.length === 0) return strictType(accepted);
    // A value of a kind that an alternative takes goes to that one, so the one that converts never gets it.
    const takenKinds = distinguishingKinds(this.alternatives.map(a => a.type)).flatMap(
      kind => primitiveOfKind.get(kind) ?? [],
    );
    return {
      ...converting[0],
      accepted,
      converted: unionType(...alternatives.map(type => type.converted)),
      refused: withoutPrimitives(unionType(converting[0].refused, ...takenKinds.map(primitiveType)), accepted),
    };
  }
  /** Every object goes to the dictionary. What else converts gets primitives, and for those no conversion runs code: it answers or throws. */
  get #convertsPrimitivesAlone(): boolean {
    const conversions = this.alternatives.map(a => a.type.parameterType.conversion);
    return conversions.includes("Dictionary") && conversions.some(c => c !== "None" && c !== "Dictionary");
  }
  /** A value goes by its kind: `300` to a `b.u8`, which throws, though `accepted` has it from an alternative that takes every kind. */
  get canRefuse(): boolean {
    const takesPartOfKind = (type: Type) =>
      membersOf(type.parameterType.accepted).some(spec => spec.type === "Integers" || spec.type === "StringLiterals");
    return (
      super.canRefuse ||
      this.#convertsPrimitivesAlone ||
      (this.valueKinds === "any" && this.alternatives.some(a => takesPartOfKind(a.type)))
    );
  }
  get idlType(): string {
    return `Bun::Bindgen::IDLTaggedUnion<${this.cpp}>`;
  }
  get convertsInPlace(): boolean {
    return true;
  }
  get tsType(): string {
    return this.alternatives.map(a => a.type.tsType).join(" | ");
  }
  get takesUndefined(): boolean {
    return this.alternatives.some(a => a.type.takesUndefined);
  }
  get dependencies(): readonly Type[] {
    return this.alternatives.map(a => a.type);
  }
  /** The alternative `null` or `undefined` goes to: `b.null` or `b.any`. */
  private alternativeOfAbsent(value: unknown) {
    if (this.isWebIDL && value != null) {
      const category = Array.isArray(value) ? "sequence" : typeof value === "object" ? "dictionary" : typeof value;
      const found = this.alternatives.find(a => a.type.unionCategory === category);
      assert(found, `${this.tsType}: no alternative for the default ${util.inspect(value)}`);
      return found;
    }
    const alternative = value == null && this.alternatives.find(a => takes(a.type, `${value}`));
    assert(
      alternative &&
        (alternative.type instanceof UnitType || (alternative.type instanceof AnyType && value === undefined)),
      `${this.tsType}: the default of a union is null or undefined, and it needs b.null as an alternative`,
    );
    return alternative;
  }
  cppAssign(target: string, value: unknown): string {
    const alternative = this.alternativeOfAbsent(value);
    const tag = `${target}.tag = ${this.alternatives.indexOf(alternative)};`;
    if (alternative.type instanceof UnitType) return tag;
    const assign = (member: string) => alternative.type.cppAssign(member, value);
    const member = `${target}.${alternative.name}`;
    return `${alternative.type.convertsInPlace ? cppEmplace(member, assign) : assign(member)}\n${tag}`;
  }
  toRust(value: unknown, scope: RustScope): string {
    const { type, variant } = this.alternativeOfAbsent(value);
    return `${this.path(scope, this.name)}::${variant}${type instanceof UnitType ? "" : `(${type.toRust(value, scope)})`}`;
  }
  get hasRustDefault(): boolean {
    return !this.isWebIDL || this.alternatives.every(a => a.type.hasRustDefault);
  }
  get elementTest() {
    const tests = this.alternatives.map(a => a.type.elementTest?.("value", anyScope));
    const lists = this.alternatives.filter(a => a.type instanceof ListType);
    return tests.includes(undefined) || new Set(tests).size < tests.length || (lists.length > 0 && tests.includes(""))
      ? null
      : () => "";
  }
  layout(): Layout {
    return taggedUnionLayout(this.alternatives.map(a => a.type.layout()));
  }
  rustExternType(scope: RustScope): string {
    return this.path(scope, `Extern${this.name}`);
  }
  rustFromExtern(expr: string, scope: RustScope): string {
    return `${this.path(scope, this.name)}::from_extern(&${expr}${this.needsLifetime ? ", heap" : ""})`;
  }
  rustToJS(value: string): string {
    return `${value}.into_js(heap)`;
  }
}

// ───────────────────────────── functions ─────────────────────────────

/** What the Rust body is handed: nothing, `&JsHeap` (allocates JS values) or `&mut JsScope` (runs JavaScript). */
export type Capability = "none" | "heap" | "js";

/** What it extends is for the table of built-ins: "What the compiler reads" in the docs. */
export interface SignatureOptions extends SignatureColumns, EntryColumns {
  args?: Record<string, Type>;
  returns?: Type;
  capability?: Capability;
  /** The body returns `Result<T, E>` for any `E: bindgen::IntoError`. */
  throws?: boolean;
  /** The function returns a promise: what the body or the conversion of an argument throws rejects one, and nothing is thrown. */
  rejects?: boolean;
  /** A call with fewer arguments throws `ERR_MISSING_ARGS`. Defaults to 0: an argument that was not passed is `undefined`. */
  requiredArguments?: number;
  /** Path of the Rust function. Defaults to the module's path plus the export's name in snake_case. */
  rustPath?: string;
  /** The body is this C++ function and no Rust one: `extern "C" SYSV_ABI JSC::EncodedJSValue symbol(JSC::JSGlobalObject*, ..)`, which takes each argument as a Rust thunk would and answers the JS value itself, or the empty value with an exception pending. */
  cppSymbol?: string;
  /** With `cppSymbol`, where every argument is a `b.any`: a function template of `header`, `name(JSC::JSGlobalObject*, const Arguments&)`, which the generated host function calls with a `Bun::Bindgen::ArgumentsInFrame`, so that it holds the body as a hand-written host function would. */
  cppInlineBody?: { name: string; header: string };
  /** The JS function's `length`. Defaults to the number of required arguments. */
  length?: number;
  /** Node's `ERR_INVALID_ARG_TYPE` for a wrong type: a list is its `(name, expected, actual)`, a string the whole message. */
  expected?: Record<string, readonly string[] | string>;
  /** An argument named here throws what src/runtime/node/util/validators.rs does for a value of the wrong type: `The "name" property must be of type string, got number`. */
  validatorExpects?: Record<string, string>;
  /** These arguments are converted before the others, in this order. */
  convertedFirst?: readonly string[];
  /** The JS function's `name`. Defaults to what it is exported as. */
  name?: string;
  /** Its own `name` property says `bound join` where it prints and is traced as `join`, as a bound function does. */
  namedAsBound?: boolean;
  replacesBoundFunction?: boolean;
}

/** What `b.fn` takes. */
export interface FunctionOptions extends SignatureOptions {
  /** Also pass `this`, `this_value: JsLocal<'a>`. */
  passThis?: boolean;
  /** Also pass the function that was called, `callee: JsLocal<'a>`. */
  passCallee?: boolean;
  /** The host function has C linkage under this name. C++ declares it with `BUN_DECLARE_HOST_FUNCTION`, and in Rust it is a `JSHostFn` of the generated module. */
  export?: string;
  /** The feature that `bun build --compile --trim` removes the function with, for one that native code makes callable: no property table and no `$bindgen` names it, so the table of built-ins has no entry that says it. */
  feature?: string;
}

/** What `b.value` takes. */
export type ValueOptions = Pick<SignatureOptions, "capability" | "throws" | "rustPath"> & { returns: Type };

/** What any member of an interface can say. */
export interface WebMemberOptions {
  /** An exception to `isCold` of `b.module`. */
  isCold?: false;
  /** `[CEReactions]`. */
  ceReactions?: boolean;
  /** `[LegacyUnforgeable]`. */
  unforgeable?: boolean;
  /** `[Unscopable]`. */
  unscopable?: boolean;
  /** `[Exposed]`, where it is less than the interface's. */
  exposed?: Exposure;
  /** `[SecureContext]`. */
  secure?: boolean;
}
const webMemberKeys = ["isCold", "ceReactions", "unforgeable", "unscopable", "exposed", "secure"] as const;
export type Exposure = readonly ("Window" | "Worker" | "DedicatedWorker" | "SharedWorker")[];

export class Signature {
  readonly args: readonly {
    name: string;
    type: Type;
    expected?: readonly string[] | string;
    validatorExpects?: string;
  }[];
  /** Indices into `args`. */
  readonly conversionOrder: readonly number[];
  readonly givenName: string | undefined;
  readonly namedAsBound: boolean;
  readonly replacesBoundFunction: boolean;
  readonly returns: Type;
  readonly capability: Capability;
  /** What the Rust function gets. The reactions of custom elements run after it. */
  readonly bodyCapability: Capability;
  readonly throws: boolean;
  readonly rejects: boolean;
  readonly requiredArguments: number;
  readonly rustPath: string | undefined;
  readonly cppSymbol: string | undefined;
  readonly cppInlineBody: { name: string; header: string } | undefined;
  readonly length: number | undefined;
  readonly columns: SignatureColumns & EntryColumns;
  /** Of an interface. */
  isWeb = false;
  readonly constructs: Pick<ConstructOptions, "passNewTarget" | "rustName">;
  /** `hasThisValue`: the body is also handed its own JS object. `isProperty`: JS can call it, so each argument is converted from a JS value. */
  constructor(options: FunctionOptions & FunctionField & ConstructOptions, hasThisValue = false, isProperty = true) {
    this.columns = columnsOf(options, [
      "args",
      "returns",
      "capability",
      "throws",
      "rejects",
      "requiredArguments",
      "passCallee",
      "export",
      "feature",
      "rustPath",
      "cppSymbol",
      "cppInlineBody",
      "length",
      "expected",
      "validatorExpects",
      "convertedFirst",
      "name",
      "namedAsBound",
      "replacesBoundFunction",
      "mutates",
      "passThis",
      "answersThis",
      "invalidThis",
      "privateSymbol",
      "rustName",
      "passStructure",
      "calledFromCpp",
      "passNewTarget",
      "otherReceivers",
      ...webMemberKeys,
    ]);
    this.constructs = options;
    this.length = options.length;
    this.givenName = options.name;
    this.namedAsBound = options.namedAsBound ?? false;
    this.replacesBoundFunction = options.replacesBoundFunction ?? false;
    this.rejects = options.rejects ?? false;
    this.requiredArguments = options.requiredArguments ?? 0;
    const { args = {}, expected = {}, validatorExpects = {}, convertedFirst = [] } = options;
    this.args = Object.entries(args).map(([name, type]) => ({
      name,
      type,
      expected: Object.hasOwn(expected, name) ? expected[name] : undefined,
      validatorExpects: Object.hasOwn(validatorExpects, name) ? validatorExpects[name] : undefined,
    }));
    for (const [name, types] of Object.entries(expected)) {
      assert(name in args, `expected: ${name} is not an argument`);
      refuseExpectedOfRange(name, args[name]);
      assert(types.length > 0, `expected: ${name} expects nothing`);
      assert(!(name in validatorExpects), `${name}: expected or validatorExpects, not both`);
    }
    for (const name of [...Object.keys(validatorExpects), ...convertedFirst]) {
      assert(name in args, `${name} is not an argument`);
    }
    assertDistinct(convertedFirst, "of convertedFirst");
    const positions = this.args.map((_, index) => index);
    const isFirst = (index: number) => convertedFirst.includes(this.args[index].name);
    this.conversionOrder = [
      ...convertedFirst.map(name => this.args.findIndex(arg => arg.name === name)),
      ...positions.filter(index => !isFirst(index)),
    ];
    this.args.forEach(({ name, type }, index) =>
      assert(
        !isMadeOf(type, RestType) || (type instanceof RestType && index === this.args.length - 1),
        `${name}: b.rest is the last argument`,
      ),
    );
    this.returns = options.returns ?? new UnitType("undefined");
    this.bodyCapability = options.capability ?? "none";
    this.capability = options.ceReactions ? "js" : this.bodyCapability;
    this.throws = options.throws ?? false;
    this.rustPath = options.rustPath;
    this.cppSymbol = options.cppSymbol;
    assert(!(this.rustPath && this.cppSymbol), "rustPath or cppSymbol, not both");
    this.cppInlineBody = options.cppInlineBody;
    assert(!this.cppInlineBody || this.cppSymbol, "cppInlineBody goes with a cppSymbol");
    assert(
      !this.cppInlineBody || this.args.every(arg => arg.type instanceof AnyType),
      "cppInlineBody takes its arguments as they are: b.any",
    );
    assertDistinct(
      this.args.map(arg => snakeCase(arg.name)),
      "arguments",
    );
    assert(
      this.length === undefined || (Number.isInteger(this.length) && this.length >= 0),
      `length: ${this.length} is not a count`,
    );
    for (const { name, type } of this.args.slice(0, -1))
      assert(!(type instanceof VariadicType), `${name}: .variadic is only for the last argument`);
    for (const { name, type } of this.args) {
      assert(
        !holdsClassWithMutates(type),
        `${name}: a class with a mutates member is not an argument type: it could be the receiver`,
      );
      refuseResultType(name, type);
      assert(!isProperty || !holdsByteSpan(type), `${name}: b.byteSpan is not a JS value`);
      assert(
        !type.borrowsHeap || this.capability !== "js",
        `${name}: JavaScript can detach a buffer; held: "handle" borrows the bytes each time they are read`,
      );
    }
    const pinned = this.args.filter(arg => arg.type.rustFromExternThrows);
    assert(pinned.length <= 1, 'held: "pinned": if one fails, nothing releases the string of the next');
    assert(
      pinned.length === 0 || !this.args.some(arg => arg.type.borrowsHeap),
      'held: "pinned" moves the bytes of a small typed array, which another argument that is held: "borrowed" can be',
    );
    // Of the modifiers, only `.withValue` goes on one.
    const taken = this.args.findIndex(
      ({ type }) => (type instanceof WithValueType ? type.inner : type) instanceof NativePromiseContextType,
    );
    assert(
      taken < 0 || this.args.slice(taken + 1).every(arg => !arg.type.conversionThrows),
      "b.nativePromiseContext takes the pointer out of the cell: if a later argument throws, nothing releases it",
    );
    assert(!(this.returns instanceof DefaultType), "a result has no default");
    assert(!isMadeOf(this.returns, RestType), "b.rest is an argument");
    refuseOutsideArgument(this.returns);
    assert(!this.rejects || this.returns.holdsJSValue, "rejects: the result is a promise");
    assert(
      Number.isInteger(this.requiredArguments) &&
        this.requiredArguments >= 0 &&
        this.requiredArguments <= this.args.length,
      `requiredArguments: ${this.requiredArguments} is not a count of the arguments`,
    );
    for (const { name, type } of this.args.slice(0, this.requiredArguments))
      assert(!isIfPassed(type), `${name}: .ifPassed is never absent in one of the requiredArguments`);
    assert(
      !this.returns.holdsJSValue || isOwnedString(this.returns) || this.capability !== "none" || hasThisValue,
      'returning a JS value takes capability: "heap" or "js"',
    );
  }
  /** The arguments up to the last that is not optional, and the `requiredArguments`: what a caller writes at least. */
  get requiredCount(): number {
    return Math.max(this.args.findLastIndex(arg => !arg.type.isOptional) + 1, this.requiredArguments);
  }
}

function isMadeOf(type: Type, kind: new (...args: never[]) => Type): boolean {
  return type instanceof kind || (type as Type).dependencies.some(dependency => isMadeOf(dependency, kind));
}

function holdsClassWithMutates(type: Type): boolean {
  return (type instanceof ClassType && !type.sharedThis) || type.dependencies.some(holdsClassWithMutates);
}

function holdsByteSpan(type: Type): boolean {
  return type instanceof ByteSpanType || type.dependencies.some(holdsByteSpan);
}

/** The first `ResultType` that `type` is or is made of. */
function resultTypeIn(type: Type): ResultType | undefined {
  if (type instanceof ResultType) return type;
  for (const dependency of type.dependencies) {
    const found = resultTypeIn(dependency);
    if (found) return found;
  }
}

function refuseOutsideArgument(type: Type, name?: string): void {
  const refusal = type.refusalOutsideArgument;
  assert(!refusal, name ? `${name}: ${refusal}` : (refusal ?? ""));
}

/** The converter of a range takes no context. */
function refuseExpectedOfRange(name: string, type: Type): void {
  assert(!(withoutModifiers(type) instanceof RangeType), `expected: ${name} is a range, which has its own errors`);
}

export function withoutModifiers(type: Type): Type {
  while (type instanceof OptionalType || type instanceof DefaultType || type instanceof WithValueType)
    type = type.inner;
  return type;
}

function refuseResultType(name: string, type: Type): void {
  const result = resultTypeIn(type);
  assert(!result, `${name}: ${result?.refusal}`);
}

/** Call a signature, or look at the kind of one more argument. */
export type OverloadDispatch = Signature | { argument: number; byKind: Map<ValueKind | "other", OverloadDispatch> };
/** WebIDL's effective overload set: what a call with that many arguments is dispatched by, the last for any more. null: none takes that many. */
export type DispatchByCount = readonly (OverloadDispatch | null)[];

export class FunctionDefinition {
  readonly signatures: readonly Signature[];
  readonly dispatch: OverloadDispatch;
  readonly passThis: boolean;
  readonly passCallee: boolean;
  readonly exportName: string | undefined;
  readonly feature: string | undefined;
  /** `b.value`: there is no JS function. */
  readonly isValue: boolean;
  name = "";
  origin: Origin | null = null;
  readonly countsArguments: boolean;
  constructor(
    signatures: readonly (SignatureOptions | Signature)[],
    options: FunctionOptions = {},
    isValue = false,
    countsArguments = false,
  ) {
    this.isValue = isValue;
    this.countsArguments = countsArguments;
    assert(signatures.length > 0, "b.overloads needs at least one signature");
    this.passThis = options.passThis ?? false;
    this.passCallee = options.passCallee ?? false;
    this.exportName = options.export;
    this.feature = options.feature;
    for (const key of ["passThis", "passCallee", "export", "feature"] as const) {
      assert(
        signatures.every(
          signature => signature instanceof Signature || (signature as FunctionOptions)[key] === options[key],
        ),
        `every overload gives ${key} the same value`,
      );
    }
    assert(
      this.exportName === undefined || /^[A-Za-z_]\w*$/.test(this.exportName),
      `export: ${this.exportName} is not a C identifier`,
    );
    this.signatures = signatures.map(options => (options instanceof Signature ? options : new Signature(options)));
    assert(this.signatures.filter(signature => signature.length !== undefined).length <= 1, "length is given once");
    assert(this.signatures.filter(signature => signature.givenName !== undefined).length <= 1, "name is given once");
    assert(
      this.exportName === undefined || this.signatures.every(signature => signature.length === undefined),
      "length: what makes an exported function gives its length",
    );
    for (const key of countsArguments ? (["rejects"] as const) : (["rejects", "requiredArguments"] as const))
      assert(
        this.signatures.every(signature => signature[key] === this.signatures[0][key]),
        `every overload gives ${key} the same value`,
      );
    assert(
      this.signatures.length === 1 ||
        !this.signatures.some(signature => signature.args.some(arg => isIfPassed(arg.type))),
      ".ifPassed is not for overloads: the kind of an argument chooses one, and an argument that is not passed has none",
    );
    if (this.isDispatchedByCount) {
      this.dispatch = this.signatures[0];
      return;
    }
    const nodes = new Map<string, OverloadDispatch>();
    this.dispatch = this.dispatchOn(this.signatures, 0, nodes);
    this.assertAllChosen(new Set(nodes.values()));
  }
  get isDispatchedByCount(): boolean {
    return this.countsArguments && this.signatures.length > 1;
  }
  /** https://webidl.spec.whatwg.org/#js-overloads. It is asked for once what `b.ref` names is declared. */
  get dispatchByCount(): DispatchByCount {
    const isVariadic = ({ args }: Signature) =>
      args.at(-1)?.type instanceof VariadicType || args.at(-1)?.type instanceof RestType;
    const most = Math.max(...this.signatures.map(signature => signature.args.length));
    const chosen = new Set<OverloadDispatch>();
    const byCount = Array.from({ length: most + 1 }, (_, count): OverloadDispatch | null => {
      const candidates = this.signatures.filter(
        signature => signature.requiredArguments <= count && (count <= signature.args.length || isVariadic(signature)),
      );
      if (candidates.length < 2) return (chosen.add(candidates[0]), candidates[0] ?? null);
      const typeAt = ({ args }: Signature, i: number) => {
        const { type } = args[Math.min(i, args.length - 1)];
        return type instanceof RestType ? type.element : type instanceof VariadicType ? new AnyType() : type;
      };
      const argument = Array.from({ length: count }).findIndex(
        (_, i) => new Set(candidates.map(it => withoutModifiers(typeAt(it, i)).idlType)).size > 1,
      );
      assert(argument >= 0, `no argument tells the overloads that take ${count} apart`);
      const alternatives = candidates.flatMap(signature => {
        const inner = withoutModifiers(typeAt(signature, argument));
        return (inner instanceof UnionType ? inner.dependencies : [inner]).map(type => ({ type, signature }));
      });
      const anything = alternatives.find(it => it.type instanceof AnyType) ?? alternatives[0];
      const byKind = new Map<ValueKind | "other", OverloadDispatch>();
      for (const [kind, list] of webAlternativesByKind(alternatives.map(it => it.type))) {
        if (kind !== "other") {
          byKind.set(kind, (alternatives[list[0]] ?? anything).signature);
          continue;
        }
        const category = (i: number) => alternatives[i].type.unionCategory;
        const of = (...categories: UnionCategory[]) => alternatives[list.find(i => categories.includes(category(i)))!];
        if (of("sequence")) byKind.set("iterable", of("sequence").signature);
        if (of("dictionary", "object")) byKind.set("object", of("dictionary", "object").signature);
        byKind.set("other", (of("string", "number", "boolean") ?? anything).signature);
      }
      const nullable = candidates.find(it => {
        const type = typeAt(it, argument);
        return type instanceof OptionalType && type.modifier !== "optional";
      });
      const omittable = candidates.find(it => typeAt(it, argument).isOmittable) ?? nullable;
      if (nullable) byKind.set("null", nullable);
      if (omittable) byKind.set("undefined", omittable);
      for (const signature of byKind.values()) chosen.add(signature);
      return { argument, byKind };
    });
    this.assertAllChosen(chosen);
    return byCount;
  }
  private assertAllChosen(chosen: ReadonlySet<OverloadDispatch>): void {
    this.signatures.forEach((signature, i) =>
      assert(
        chosen.has(signature),
        `overload ${i + 1} is never chosen: the ones before it take every call it would. Move it earlier or remove it`,
      ),
    );
  }
  /** "Overloads" in the docs. Equal inputs give the same object of `nodes`: nodes are compared by identity. */
  private dispatchOn(
    candidates: readonly Signature[],
    argument: number,
    nodes: Map<string, OverloadDispatch>,
  ): OverloadDispatch {
    const key = `${candidates.map(signature => this.signatures.indexOf(signature))} ${argument}`;
    const existing = nodes.get(key);
    if (existing) return existing;
    let dispatch: OverloadDispatch = candidates[0];
    if (candidates.length > 1 && candidates.some(signature => argument < signature.args.length)) {
      const types = candidates.map(signature => signature.args[argument]?.type);
      const next = (kind: ValueKind | "other") => {
        const keep = (test: (type: Type) => boolean) =>
          candidates.filter((signature, i) => (types[i] ? test(types[i]) : kind === "undefined"));
        const ofKind = keep(type => takes(type, kind));
        const takers = kind === "undefined" ? keep(type => type.takesUndefined) : ofKind;
        const kept = [takers, ofKind, candidates.filter((signature, i) => types[i])].find(list => list.length > 0)!;
        return this.dispatchOn(kept, argument + 1, nodes);
      };
      const kinds = new Set(["undefined" as const, ...distinguishingKinds(types.filter(type => type !== undefined))]);
      const byKind = new Map([...kinds].map(kind => [kind, next(kind)]));
      dispatch = new Set(byKind.values()).size === 1 ? byKind.get("other")! : { argument, byKind };
    }
    nodes.set(key, dispatch);
    return dispatch;
  }
  /** The `name` of the JS function. */
  get jsName(): string {
    return this.signatures.find(signature => signature.givenName !== undefined)?.givenName ?? this.name;
  }
  get namedAsBound(): boolean {
    return this.signatures.some(signature => signature.namedAsBound);
  }
  get replacesBoundFunction(): boolean {
    return this.signatures.some(signature => signature.replacesBoundFunction);
  }
  get length(): number {
    const given = this.signatures.find(signature => signature.length !== undefined);
    if (this.countsArguments) return given?.length ?? Math.min(...this.signatures.map(it => it.requiredArguments));
    return given?.length ?? Math.min(...this.signatures.map(signature => signature.requiredCount));
  }
}

// ───────────────────────────── classes ─────────────────────────────

/** A native function. */
export interface FunctionField
  extends Omit<SignatureOptions, "rustPath" | "cppSymbol" | "cppInlineBody">, WebMemberOptions {
  /** Of an interface: the C++ host function that a call gets whose `this` is not an instance. */
  otherReceivers?: string;
  /** `&mut self` instead of `&self`. No member of such a class has `capability: "js"`, and the class is not an argument type. */
  mutates?: boolean;
  /** Also pass the wrapper, `this_value: JsWrapper<'a, Self>`. */
  passThis?: boolean;
  /** It returns its receiver: every arm of the Rust function hands back the wrapper that `passThis` passes. The thunk hands that on and holds it to nothing. */
  answersThis?: boolean;
  /** When `this` is not an instance: `"throw"` (the default) throws `ERR_INVALID_THIS`, `"undefined"` returns `undefined`. */
  invalidThis?: "throw" | "undefined";
  /** Key the function by this private builtin name (`$name` in src/js) instead of a string. */
  privateSymbol?: string;
  /** The Rust function. Defaults to the property's name in snake_case. */
  rustName?: string;
  /** Overrides the function's `name`. Only for an `@@` key, where it defaults to `[Symbol.x]`. */
  name?: string;
  /** Also a member function of the generated C++ class. It takes `globalObject` and a `JSValue` for each argument, and converts them as a call from JS does. */
  calledFromCpp?: boolean;
}

/** A member function of the generated C++ class that is defined in Rust. */
export interface CalledFromCppField {
  /** Each is `b.any`, `b.bool`, a number or `b.byteSpan`. */
  args?: Record<string, Type>;
  /** `b.any`, `b.bool`, a number, or nothing. */
  returns?: Type;
  /** With this or `throws`, `globalObject` is the first parameter. */
  capability?: Capability;
  /** It returns `b.any`, which is empty if it threw, or nothing. */
  throws?: boolean;
}

/** A member function of the generated C++ class that is defined in hand-written C++. */
export interface CalledFromRustField {
  /** Each is `b.any`, `b.bool` or a number. */
  args?: Record<string, Type>;
  /** `b.any`, or nothing. */
  returns?: Type;
  /** `"heap"`: it allocates JS values. `"js"`: it runs JavaScript. With either or `throws`, `globalObject` is the first parameter, and `global` follows `this_value` in Rust. */
  capability?: Capability;
  /** The Rust function returns a `JsResult`. */
  throws?: boolean;
}

/** A `JSCell` subclass and the header that declares it. */
export class CellClass {
  readonly cpp: string;
  readonly header: string;
  constructor(cpp: string, header: string) {
    this.cpp = cpp;
    this.header = header;
    assert(/^([A-Za-z_]\w*::)+[A-Z]\w*$/.test(cpp), `b.cell: ${cpp} needs its namespace`);
  }
}

export interface GetterField extends SignatureColumns, EntryColumns, WebMemberOptions {
  getter: Type;
  /** Also generate a setter. In a class that has a `mutates` member it takes `&mut self`. Its `capability`, `throws` and type are the getter's unless it names its own. */
  setter?: true | { capability?: Capability; throws?: boolean; type?: Type };
  /** Of an interface: it returns this internal field, or `null` if that is empty, and there is no getter in Rust. */
  field?: string;
  /** With `field`: while that is empty, the getter in Rust answers. */
  computedIfEmpty?: true;
  /** Key the accessor by this private builtin name instead of a string. */
  privateSymbol?: string;
  /** `[PutForwards]`. */
  putForwards?: string;
  /** `[Replaceable]`. */
  replaceable?: boolean;
  /** `[LegacyLenientThis]`. */
  lenientThis?: boolean;
  /** `[LegacyLenientSetter]`. */
  lenientSetter?: boolean;
  /** `toString()` returns it too. */
  stringifier?: boolean;
  /** For an enumeration: assigning what is none of its values does nothing. */
  ignoreInvalid?: boolean;
  /** It returns a promise: what it throws rejects one. */
  rejects?: boolean;
  /** Returns an internal field, and computes it while that is empty. `true` declares one of the getter's name, a string names one declared elsewhere. */
  cache?: true | string;
  /** With `cache`: any value assigned to the property replaces the cached one, without calling Rust. */
  writable?: true;
  capability?: Capability;
  throws?: boolean;
  /** As a function's. */
  passThis?: boolean;
  /** The getter is `get_` and this name, the setter `set_` and this name. Defaults to the property's name in snake_case. */
  rustName?: string;
  /** Defaults to the class's. */
  configurable?: boolean;
  /** Somebody has read the Rust getter down to the last function it calls: it allocates nothing in the JavaScript heap, throws nothing, runs no JavaScript, walks no stack, takes no lock that a collection waits for, and changes nothing that a program can see. */
  pure?: boolean;
  /** Defaults to the class's. */
  enumerable?: boolean;
}

/** An accessor that reads an internal field in C++, without calling Rust. With `setter: true` it also stores any value assigned to it. */
export interface InternalFieldField {
  internalField: string;
  setter?: true;
}

/** A function written in JavaScript: the export of this name in `src/js/builtins/<class name>.ts`, without the `@@` of a symbol's key. */
export interface BuiltinField {
  builtin: true;
  length: number;
}

/** An integer that every instance shares, like a WebIDL `const`: a read-only data property. */
export interface ConstantField {
  constant: number;
  /** Defaults to the class's. */
  configurable?: boolean;
  /** Defaults to the class's. */
  enumerable?: boolean;
}

/** Several functions are the overloads of one. `rustName` tells their Rust functions apart. A key that starts with `@@` is a well-known symbol: `@@iterator` is `Symbol.iterator`. `@@inspectCustom` is `Symbol.for("nodejs.util.inspect.custom")`. */
export type Field =
  | FunctionField
  | readonly FunctionField[]
  | GetterField
  | InternalFieldField
  | BuiltinField
  | ConstantField
  | FamilyMember;
export type StaticField =
  | Omit<
      FunctionField,
      "mutates" | "passThis" | "answersThis" | "invalidThis" | "privateSymbol" | "name" | "calledFromCpp"
    >
  | Omit<GetterField, "cache" | "writable" | "passThis">
  | ConstantField;

export interface ConstructOptions extends Omit<SignatureOptions, "rustPath" | "returns"> {
  /** The constructor creates the object itself, with `structure.create(..)`, and returns it: it can then set internal fields. */
  passStructure?: boolean;
  /** Of an interface: the constructor gets `new.target` and the class that was called, and returns any object. */
  passNewTarget?: boolean;
  /** Of an overload: the Rust function. Defaults to `constructor`. */
  rustName?: string;
}

type ClassTableColumns = Pick<ClassColumns, "slots" | "stateHeap" | "types" | "lockedMembers"> & EntryColumns;

export interface ClassOptions extends ClassTableColumns {
  /** Path of the Rust struct. The members are its own methods. A class with `extends` has its base's. */
  rustPath?: string;
  /** The class inherits from this one, which has `final: false`, as one WebIDL interface does from another. See "extends" in the docs. */
  extends?: ClassType;
  /** The struct is intrusively refcounted and the JS object holds one ref, so it can outlive the object. Every member takes `&self`. */
  refCounted?: boolean;
  /** With `refCounted`: call `fn finalize(&self)` when the object is collected, before its ref is dropped. */
  finalize?: boolean;
  /** `false`: a class with `extends` or hand-written C++ can subclass `JSName`, and an instance of the subclass is an instance of this class. The subclass adds no fields. */
  final?: boolean;
  /** `impl bun_jsc::JsClass` is not generated: write it by hand, calling `js_Name::to_js` and `js_Name::from_js`. With `refCounted`. */
  overridesToJS?: boolean;
  /** JavaScript only sees a function bound to the instance. Members are called with that function as `this` and get its `boundThis`. */
  forBind?: boolean;
  /** The struct's method that calls every native function of `proto`. It receives a pointer to the function. */
  protoCaller?: string;
  /** The struct's method that runs every method with `mutates`. It receives a closure that takes the struct. */
  mutator?: string;
  /** Traits to bring into scope, for members that are trait methods. */
  rustTraits?: readonly string[];
  /** `"Error"`: the prototype inherits from `Error.prototype` instead of `Object.prototype`, and its `name` is the class's. `"EventEmitter"`: it inherits from that of `node:events`, and so does the constructor. `"Readable"`, `"Writable"`: of `node:stream`, whose constructor has yet to be called on an instance. `"AbortController"`, `"AbortSignal"`: JavaScript sees one of those, whose `$impl` is the instance. `"WritableStream"`: JavaScript sees a stream, of which the instance is the sink. */
  prototypeBase?:
    | "Error"
    | "DOMException"
    | "EventEmitter"
    | "Iterator"
    | "AsyncIterator"
    | "WritableStream"
    | "AbortController"
    | "AbortSignal"
    | "EventTarget"
    | "Readable"
    | "Writable";
  /** `true`: native properties are configurable. */
  configurable?: boolean;
  /** `false`: native properties are non-enumerable. */
  enumerable?: boolean;
  /** `false`: native functions are read-only. */
  writable?: boolean;
  /** `fn memory_cost(&self) -> usize`: the extra memory the struct owns, for a heap snapshot. */
  memoryCost?: boolean;
  /** `fn estimated_size(&self) -> usize`: the same for the GC, whose marking threads call it. For a heap snapshot too, without `memoryCost`. */
  estimatedSize?: boolean;
  /** Absent: JavaScript cannot construct one, and there is no constructor object. `"illegal"`: there is one, and `new` on it throws `Illegal constructor`. */
  construct?: ConstructOptions | "illegal";
  /** `Name(..)` without `new`, which otherwise throws. The Rust function is `call`. */
  call?: Omit<SignatureOptions, "rustPath">;
  /** `instance(..)`, which makes `typeof instance` `"function"`. The Rust function is `call_instance`. */
  callInstance?: Omit<SignatureOptions, "rustPath"> & Pick<FunctionField, "passThis">;
  /**
   * JS values the object holds, empty at first. The GC visits them; `js_Name` gets `x_get_cached` / `x_set_cached` / `x_take_cached` for each.
   * In a record each field names its type: `b.any` is what a list declares, and `b.cell("JSC::JSPromise", ..)` makes `m_x` a `WriteBarrier<JSC::JSPromise>` that only hand-written C++ uses.
   */
  internalFields?: readonly string[] | Readonly<Record<string, AnyType | CellClass | ClassType | SelfType>>;
  /** Properties of the prototype. */
  proto?: Record<string, Field>;
  /** Properties of the constructor. */
  static?: Record<string, StaticField>;
  /** What C++ calls in Rust and is not a property: `thisObject->x(..)` calls `Name::x(&self, ..)`. */
  calledFromCpp?: Record<string, CalledFromCppField>;
  /** What Rust calls in C++: `js_Name::x(this_value, ..)` calls `JSName::x(..)`, which the generated class declares and hand-written C++ defines. */
  calledFromRust?: Record<string, CalledFromRustField>;
}

/** The property's name without a leading `_` or `@@`, for use in generated identifiers. */
export const memberIdentifier = (name: string) => name.replace(/^(_+|@@)/, "");
/** `iterator` for the key `@@iterator`, `undefined` for a key that is not a symbol. */
export const wellKnownSymbol = (name: string) => (name.startsWith("@@") ? name.slice(2) : undefined);
/** The `description` of the symbol of an `@@` key. */
export const symbolDescription = (name: string) =>
  name === "@@inspectCustom" ? "nodejs.util.inspect.custom" : `Symbol.${wellKnownSymbol(name)}`;

type Receiver = "ref" | "mut" | "static";
const memberReceiver = (isStatic: boolean, sharedThis: boolean, mutates: boolean): Receiver =>
  isStatic ? "static" : mutates && !sharedThis ? "mut" : "ref";
const refuseReentrancy = (name: string, isStatic: boolean, sharedThis: boolean, capability: Capability) =>
  assert(
    isStatic || sharedThis || capability !== "js",
    `${name}: JavaScript could call a mutates member of the same object while this one runs`,
  );

function memberRustName(name: string): string {
  assert(/^[a-z_][a-z0-9_]*$/.test(name), `${name}: rustName is written in snake_case`);
  return rustIdent(name);
}

/** The declaration in the generated header has these names. */
function refuseCppMemberFunctionNames(name: string, args: readonly { name: string }[]) {
  assert(/^[a-z][A-Za-z0-9]*$/.test(name), `${name}: a C++ member function is named in camelCase`);
  assert(!cppKeywords.has(name), `${name} is a C++ keyword`);
  for (const arg of args) {
    assert(/^[a-z][A-Za-z0-9]*$/.test(arg.name), `${name}: ${arg.name}: a C++ parameter is named in camelCase`);
    assert(!cppKeywords.has(arg.name), `${name}: ${arg.name} is a C++ keyword`);
  }
}
/** Passed between C++ and Rust without conversion. */
const isPassedAsIs = (type: Type) => type instanceof AnyType || type instanceof PrimitiveType;

export class Method extends Signature {
  readonly name: string;
  readonly rustName: string;
  readonly hasDefaultRustName: boolean;
  readonly receiver: Receiver;
  readonly passThis: boolean;
  readonly answersThis: boolean;
  readonly invalidThis: "throw" | "undefined";
  readonly privateSymbol: string | undefined;
  readonly functionName: string | undefined;
  readonly calledFromCpp: boolean;
  /** A property of the prototype or the constructor, so JS can call it. */
  readonly isProperty: boolean;
  readonly web: WebMemberOptions;
  readonly otherReceivers: string | undefined;
  constructor(
    name: string,
    options: FunctionField,
    isStatic = false,
    sharedThis = false,
    isProperty = true,
    reachesOwnObject = false,
  ) {
    super(options, !isStatic && (reachesOwnObject || !!options.passThis), isProperty);
    this.web = options;
    this.otherReceivers = options.otherReceivers;
    this.name = name;
    this.isProperty = isProperty;
    this.calledFromCpp = !!options.calledFromCpp;
    if (this.calledFromCpp) {
      refuseCppMemberFunctionNames(name, this.args);
      assert(
        !this.args.some(arg => arg.type instanceof VariadicType),
        `${name}: a calledFromCpp function has no .variadic`,
      );
      assert(!this.rejects, `${name}: a calledFromCpp function throws, so it has no rejects`);
    }
    if (!isProperty) {
      for (const arg of this.args)
        assert(
          isPassedAsIs(arg.type) || arg.type instanceof ByteSpanType,
          `${name}: ${arg.name} is b.any, b.bool, a number or b.byteSpan`,
        );
      assert(
        this.returns instanceof UnitType || isPassedAsIs(this.returns),
        `${name}: returns b.any, b.bool, a number or nothing`,
      );
      assert(
        !this.throws || !(this.returns instanceof PrimitiveType),
        `${name}: a function that throws returns b.any or nothing`,
      );
    }
    this.rustName = memberRustName(options.rustName ?? snakeCase(memberIdentifier(name)));
    this.hasDefaultRustName = options.rustName === undefined;
    refuseReentrancy(name, isStatic, sharedThis, this.capability);
    this.receiver = memberReceiver(isStatic, sharedThis, !!options.mutates);
    this.passThis = !isStatic && !!options.passThis;
    this.answersThis = !!options.answersThis;
    assert(
      !this.answersThis || (this.passThis && this.returns instanceof ClassType),
      `${name}: answersThis takes passThis and returns: b.self`,
    );
    this.invalidThis = options.invalidThis ?? "throw";
    this.privateSymbol = options.privateSymbol;
    assert(!(this.privateSymbol && wellKnownSymbol(name)), `${name}: an @@ key has no privateSymbol`);
    this.functionName = options.name;
    assert(this.functionName === undefined || wellKnownSymbol(name), `${name}: name is only for an @@ key`);
  }
}

/** One of a class's `calledFromRust`. */
export class CalledFromRustFunction {
  readonly name: string;
  readonly args: readonly { name: string; type: Type }[];
  readonly returnsValue: boolean;
  readonly throws: boolean;
  readonly takesGlobalObject: boolean;
  constructor(name: string, options: CalledFromRustField) {
    this.name = name;
    this.args = Object.entries(options.args ?? {}).map(([name, type]) => ({ name, type }));
    refuseCppMemberFunctionNames(name, this.args);
    for (const arg of this.args) assert(isPassedAsIs(arg.type), `${name}: ${arg.name} is b.any, b.bool or a number`);
    assert(options.returns === undefined || options.returns instanceof AnyType, `${name}: returns b.any or nothing`);
    this.returnsValue = options.returns !== undefined;
    this.throws = options.throws ?? false;
    this.takesGlobalObject = this.throws || (options.capability ?? "none") !== "none";
  }
}

export class Getter {
  readonly name: string;
  readonly type: Type;
  readonly capability: Capability;
  readonly throws: boolean;
  /** Has a setter written in Rust. */
  readonly hasSetter: boolean;
  readonly writable: boolean;
  readonly internalField: string | undefined;
  readonly declaresInternalField: boolean;
  readonly isStatic: boolean;
  readonly rustName: string;
  readonly setterRustName: string;
  readonly hasDefaultRustName: boolean;
  readonly receiver: Receiver;
  readonly setterReceiver: Receiver;
  readonly passThis: boolean;
  readonly setterCapability: Capability;
  readonly configurable: boolean | undefined;
  readonly isPure: boolean;
  readonly columns: SignatureColumns & EntryColumns;
  readonly enumerable: boolean | undefined;
  readonly setterType: Type;
  readonly setterThrows: boolean;
  /** What only a member of an interface says. */
  readonly web: GetterField;
  /** The body is the family's, which gets this key. */
  readonly family: FamilyMember | undefined;
  constructor(
    name: string,
    options: GetterField,
    isStatic = false,
    sharedThis = false,
    reachesOwnObject = false,
    family?: FamilyMember,
  ) {
    this.web = options;
    this.family = family;
    this.columns = columnsOf(options, [
      "getter",
      "setter",
      "cache",
      "writable",
      "capability",
      "throws",
      "passThis",
      "rustName",
      "configurable",
      "enumerable",
      "pure",
      "field",
      "computedIfEmpty",
      "privateSymbol",
      "putForwards",
      "replaceable",
      "lenientThis",
      "lenientSetter",
      "stringifier",
      "ignoreInvalid",
      "rejects",
      ...webMemberKeys,
    ]);
    this.name = name;
    this.isStatic = isStatic;
    const rustName = options.rustName ?? snakeCase(memberIdentifier(name));
    this.rustName = memberRustName(`get_${rustName}`);
    this.setterRustName = `set_${rustName}`;
    this.hasDefaultRustName = options.rustName === undefined;
    this.type = options.getter;
    this.capability = options.capability ?? "none";
    const setter = typeof options.setter === "object" ? options.setter : {};
    this.setterCapability = setter.capability ?? this.capability;
    this.setterType = setter.type ?? this.type;
    this.setterThrows = setter.throws ?? options.throws ?? false;
    refuseReentrancy(name, isStatic, sharedThis, this.capability);
    refuseReentrancy(name, isStatic, sharedThis, this.setterCapability);
    this.receiver = memberReceiver(isStatic, sharedThis, false);
    this.setterReceiver = memberReceiver(isStatic, sharedThis, true);
    this.passThis = !!options.passThis;
    assert(!(this.passThis && isStatic), `${name}: a static getter has no passThis`);
    this.throws = options.throws ?? false;
    this.hasSetter = !!options.setter;
    this.writable = !!options.writable;
    assert(!this.writable || options.cache || options.field, `${name}: writable is only for a cached getter`);
    assert(
      !(this.writable && this.hasSetter),
      `${name}: writable stores the value itself, so there is no setter to call`,
    );
    assert(
      !(options.cache && this.hasSetter && !this.passThis && !reachesOwnObject),
      `${name}: the setter of a cached getter takes passThis, to replace the cached value`,
    );
    if (this.hasSetter) refuseResultType(name, this.setterType);
    assert(
      [this.hasSetter, this.writable, options.putForwards, options.replaceable, options.lenientSetter].filter(Boolean)
        .length <= 1,
      `${name}: one of setter, writable, putForwards, replaceable and lenientSetter`,
    );
    assert(!(options.field && options.cache), `${name}: field or cache, not both`);
    assert(!(isStatic && options.cache), `${name}: a static getter has no cache`);
    assert(
      !this.type.holdsJSValue || this.capability !== "none" || this.passThis || reachesOwnObject,
      `${name}: returning a JS value takes capability: "heap" or "js"`,
    );
    this.internalField = options.cache === true ? memberIdentifier(name) : (options.cache ?? options.field);
    this.declaresInternalField = options.cache === true;
    this.configurable = options.configurable;
    this.isPure = options.pure ?? false;
    assert(
      !this.isPure || (this.capability === "none" && !this.throws && !options.cache && !this.passThis),
      `${name}: a pure getter has no capability, throws, cache or passThis`,
    );
    assert(
      !this.isPure || holdsNoCell(this.type.resultType),
      `${name}: a pure getter allocates nothing, so ${this.type.tsType} is not what it answers`,
    );
    this.enumerable = options.enumerable;
  }
}

export class InternalFieldAccessor {
  readonly name: string;
  readonly internalField: string;
  readonly hasSetter: boolean;
  constructor(name: string, options: InternalFieldField) {
    this.name = name;
    this.internalField = options.internalField;
    this.hasSetter = options.setter ?? false;
  }
}

export class Builtin {
  readonly name: string;
  readonly length: number;
  constructor(name: string, length: number) {
    this.name = name;
    this.length = length;
  }
}

export class Constant {
  readonly name: string;
  readonly value: number;
  readonly configurable: boolean | undefined;
  readonly enumerable: boolean | undefined;
  constructor(name: string, options: ConstantField) {
    assert(Number.isSafeInteger(options.constant), `${name}: a constant is an integer`);
    this.name = name;
    this.value = options.constant;
    this.configurable = options.configurable;
    this.enumerable = options.enumerable;
  }
}

/** `Family.of(key)`. */
export class FamilyMember {
  readonly family: ClassType;
  /** In the family's table of keys. */
  readonly index: number;
  readonly options: Partial<GetterField>;
  get isByName(): boolean {
    return !this.family.web!.keyType;
  }
  constructor(family: ClassType, index: number, options: Partial<GetterField>) {
    this.family = family;
    this.index = index;
    this.options = options;
  }
}

export type ClassMember = FunctionDefinition | Getter | InternalFieldAccessor | Builtin | Constant;

/** Stands for the class being declared, in its own signatures. */
class SelfType extends Type {
  readonly idlType = "";
  readonly tsType = "this";
  get parameterType(): ParameterType {
    return this.toCpp() as never;
  }
  toCpp(): string {
    throw new TypeError(
      "b.self is an argument, a result or a getter of the class's own members, used directly or as .optional / .nullable: not in an array",
    );
  }
  layout(): Layout {
    return this.toCpp() as never;
  }
  rustExternType(): string {
    return this.toCpp();
  }
  rustType(): string {
    return this.toCpp();
  }
}
export const selfType = new SelfType();

/** As a result: the wrapper, `JsWrapper<'a, T>`. As an argument: `&'a T`. */
export class ClassType extends NamedType {
  /** What it `extends`. */
  base!: ClassType | undefined;
  /** Of the class that has no base: its own and those of every subclass. */
  #rustFunctions: readonly string[] = [];
  #rustPath: string | undefined;
  refCounted!: boolean;
  /** No member has `mutates`, so every member takes `&self`. */
  sharedThis!: boolean;
  finalize!: boolean;
  construct!: Signature | null;
  passStructure!: boolean;
  call!: FunctionDefinition | null;
  callInstance!: FunctionDefinition | null;
  memoryCost!: boolean;
  estimatedSize!: boolean;
  overridesToJS!: boolean;
  final!: boolean;
  rustTraits!: readonly string[];
  forBind!: boolean;
  protoCaller!: string | undefined;
  mutator!: string | undefined;
  illegalConstructor!: boolean;
  /** The native functions of the prototype. The signatures of each are `Method`s. */
  functions!: readonly FunctionDefinition[];
  getters!: readonly Getter[];
  internalFieldAccessors!: readonly InternalFieldAccessor[];
  staticFunctions!: readonly FunctionDefinition[];
  staticGetters!: readonly Getter[];
  builtins!: readonly Builtin[];
  constants!: readonly Constant[];
  calledFromCpp!: readonly Method[];
  calledFromRust!: readonly CalledFromRustFunction[];
  /** The properties of the prototype and of the constructor, as written. */
  protoMembers!: readonly ClassMember[];
  staticMembers!: readonly ClassMember[];
  /** The schema's, then those of `cache: true` getters. */
  internalFields!: readonly string[];
  /** The `b.cell` internal fields. */
  internalFieldClasses!: ReadonlyMap<string, CellClass>;
  configurable!: boolean;
  enumerable!: boolean;
  writable!: boolean;
  prototypeBase!: ClassOptions["prototypeBase"];
  columns!: ClassTableColumns;
  /** Index in `AdditionsToGlobalObject::m_classes`. Set by the generator. */
  classIndex = -1;
  /** The internal fields that hold an instance of an interface. */
  readonly internalFieldInterfaces = new Map<string, ClassType>();
  /** What `b.interface`, `b.mixin` and `b.family` add. */
  web: WebInterface | undefined;
  /** Without `options` it is only named: `b.ref`. */
  constructor(options?: ClassOptions) {
    super();
    if (options) this.define(options);
    else Object.assign(this, { sharedThis: true, refCounted: false, web: new WebInterface("", "interface", {}) });
  }
  define(options: ClassOptions): void {
    const { web } = this;
    this.columns = columnsOf(options, [
      "rustPath",
      "extends",
      "refCounted",
      "finalize",
      "final",
      "overridesToJS",
      "forBind",
      "protoCaller",
      "mutator",
      "rustTraits",
      "prototypeBase",
      "configurable",
      "enumerable",
      "writable",
      "memoryCost",
      "estimatedSize",
      "construct",
      "call",
      "callInstance",
      "internalFields",
      "proto",
      "static",
      "calledFromCpp",
      "calledFromRust",
    ]);
    this.base = options.extends;
    if (this.base && !web) {
      assert(!this.base.web, "extends: what extends an interface is an interface");
      assert(!this.base.final, "extends: the base has final: false");
      assert(!this.base.refCounted && !this.base.forBind, "extends: the base is not refCounted or forBind");
      for (const key of [
        "rustPath",
        "refCounted",
        "finalize",
        "overridesToJS",
        "forBind",
        "prototypeBase",
        "memoryCost",
        "estimatedSize",
        "call",
        "internalFields",
        "static",
        "calledFromCpp",
        "calledFromRust",
      ] as const)
        assert(options[key] === undefined, `${key}: a class with extends has what its base has`);
      assert(
        options.construct === undefined || (options.construct === "illegal" && this.base.construct),
        'extends: construct is "illegal", and the base has a constructor too',
      );
    }
    assert(web || this.base || options.rustPath !== undefined, "a class has a rustPath");
    this.#rustPath = web ? options.rustPath : (this.base?.rustPath ?? options.rustPath);
    this.refCounted = options.refCounted ?? false;
    this.finalize = options.finalize ?? false;
    assert(this.refCounted || !this.finalize, "finalize is only for a refCounted class: otherwise implement Drop");
    this.sharedThis = !Object.values(options.proto ?? {})
      .flat()
      .some(field => "mutates" in field && field.mutates);
    assert(this.sharedThis || !this.refCounted, "a refCounted class has no mutates: every member takes &self");
    assert(
      this.sharedThis || (!this.base && (options.final ?? true)),
      "a class that is or has a subclass has no mutates",
    );
    assert(
      this.sharedThis || !options.estimatedSize,
      "estimatedSize: a marking thread would read the struct while a mutates member writes it",
    );
    const own = (type: Type): Type => {
      if (type === selfType) return this;
      return type instanceof OptionalType && type.inner === selfType
        ? new OptionalType(this, type.modifier, type.isOmittable)
        : type;
    };
    const resolve = <T extends SignatureOptions>(signature: T): T => ({
      ...signature,
      args: Object.fromEntries(Object.entries(signature.args ?? {}).map(([name, type]) => [name, own(type)])),
      ...(signature.returns ? { returns: own(signature.returns) } : {}),
      ...(web && signature.requiredArguments === undefined
        ? { requiredArguments: Object.values(signature.args ?? {}).findLastIndex(type => !type.isOmittable) + 1 }
        : {}),
    });
    this.illegalConstructor = options.construct === "illegal";
    this.construct = options.construct
      ? new Signature(options.construct === "illegal" ? {} : resolve(options.construct))
      : null;
    this.passStructure = typeof options.construct === "object" && !!options.construct.passStructure;
    assert(
      !this.passStructure || this.construct!.capability !== "none",
      'passStructure: creating the object takes capability: "heap" or "js"',
    );
    this.memoryCost = options.memoryCost ?? false;
    this.estimatedSize = options.estimatedSize ?? false;
    this.overridesToJS = options.overridesToJS ?? false;
    assert(this.refCounted || !this.overridesToJS, "overridesToJS is only for a refCounted class");
    this.final = options.final ?? true;
    this.rustTraits = options.rustTraits ?? [];
    this.forBind = options.forBind ?? false;
    assert(
      !(this.forBind && options.prototypeBase),
      "forBind has no prototypeBase: the prototype inherits from Function.prototype",
    );
    const members = (fields: Record<string, Field>, isStatic: boolean) =>
      Object.entries(fields).map(([name, field]): ClassMember => {
        assert(
          !wellKnownSymbol(name) || !("internalField" in field || "getter" in field || "constant" in field),
          `${name}: only a function has an @@ key`,
        );
        if (field instanceof FamilyMember) {
          const options = { ...field.family.web!.accessor!, ...field.options, rustName: "value" };
          return new Getter(name, options, isStatic, true, true, field);
        }
        if ("builtin" in field) {
          assert(!isStatic, `${name}: a builtin is a property of the prototype`);
          return new Builtin(name, field.length);
        }
        if ("internalField" in field) {
          assert(!isStatic, `${name}: an internalField accessor is a property of the prototype`);
          return new InternalFieldAccessor(name, field);
        }
        if ("constant" in field) {
          assert(!isStatic || web, `${name}: a constant is a property of the prototype`);
          return new Constant(name, field);
        }
        if ("getter" in field) {
          assert(!("args" in field || "returns" in field), `${name}: a getter has no args or returns`);
          const setter =
            typeof field.setter === "object" && field.setter.type
              ? { ...field.setter, type: own(field.setter.type) }
              : field.setter;
          return new Getter(name, { ...field, getter: own(field.getter), setter }, isStatic, this.sharedThis, !!web);
        }
        const overloads: readonly FunctionField[] = Array.isArray(field) ? field : [field];
        for (const key of ["privateSymbol", "invalidThis", "name", "enumerable", "configurable"] as const)
          assert(
            overloads.every(overload => overload[key] === overloads[0]?.[key]),
            `${name}: every overload gives ${key} the same value`,
          );
        assert(
          overloads.length === 1 || !overloads.some(overload => overload.calledFromCpp),
          `${name}: a calledFromCpp function has no overloads`,
        );
        assert(!(isStatic && wellKnownSymbol(name)), `${name}: an @@ key is a property of the prototype`);
        const fn = new FunctionDefinition(
          overloads.map(overload => new Method(name, resolve(overload), isStatic, this.sharedThis, true, !!web)),
          {},
          false,
          !!web,
        );
        fn.name = name;
        return fn;
      });
    this.protoMembers = members(options.proto ?? {}, false);
    this.staticMembers = members(options.static ?? {}, true);
    assert(this.construct || !options.call, "call needs a constructor object: add construct");
    this.call = options.call ? (members({ call: options.call }, true)[0] as FunctionDefinition) : null;
    this.callInstance = options.callInstance
      ? (members({ callInstance: options.callInstance }, false)[0] as FunctionDefinition)
      : null;
    assert(
      !(this.callInstance && (this.forBind || options.prototypeBase)),
      "callInstance has no forBind or prototypeBase: the prototype inherits from Function.prototype",
    );
    this.calledFromCpp = Object.entries(options.calledFromCpp ?? {}).map(
      ([name, field]) => new Method(name, { ...field, calledFromCpp: true }, false, this.sharedThis, false),
    );
    this.calledFromRust = Object.entries(options.calledFromRust ?? {}).map(
      ([name, field]) => new CalledFromRustFunction(name, field),
    );
    this.functions = this.protoMembers.filter(member => member instanceof FunctionDefinition);
    this.protoCaller = options.protoCaller === undefined ? undefined : memberRustName(options.protoCaller);
    this.mutator = options.mutator === undefined ? undefined : memberRustName(options.mutator);
    assert(
      this.protoCaller === undefined ||
        this.functions.every(
          ({ signatures: [signature, ...overloads] }) =>
            overloads.length === 0 &&
            signature.capability === "js" &&
            signature.throws &&
            signature.returns instanceof AnyType &&
            signature.args.every(({ type }) => type instanceof AnyType || type instanceof VariadicType),
        ),
      'protoCaller: a function of proto has no overloads, and has capability: "js", throws: true, returns: b.any and arguments that are b.any',
    );
    assert(!(this.protoCaller !== undefined && this.refCounted), "protoCaller is not for a refCounted class");
    this.getters = this.protoMembers.filter(member => member instanceof Getter);
    this.internalFieldAccessors = this.protoMembers.filter(member => member instanceof InternalFieldAccessor);
    this.builtins = this.protoMembers.filter(member => member instanceof Builtin);
    this.constants = this.protoMembers.filter(member => member instanceof Constant);
    this.staticFunctions = this.staticMembers.filter(member => member instanceof FunctionDefinition);
    this.staticGetters = this.staticMembers.filter(member => member instanceof Getter);
    const { getters } = this;
    assert(this.construct || this.staticMembers.length === 0, "static members need a constructor object");
    const declaredFields = options.internalFields ?? [];
    this.internalFields = [
      ...(Array.isArray(declaredFields) ? declaredFields : Object.keys(declaredFields)),
      ...getters.filter(getter => getter.declaresInternalField).map(getter => getter.internalField!),
    ];
    const internalFieldClasses = new Map<string, CellClass>();
    if (!Array.isArray(declaredFields))
      for (const [field, type] of Object.entries(declaredFields)) {
        const held = type instanceof Type ? own(type) : type;
        if (web && held instanceof ClassType && held.web) {
          this.internalFieldInterfaces.set(field, held);
          continue;
        }
        assert(type instanceof AnyType || type instanceof CellClass, `${field}: an internal field is b.any or b.cell`);
        if (type instanceof CellClass) internalFieldClasses.set(field, type);
      }
    this.internalFieldClasses = internalFieldClasses;
    for (const { type, internalField, declaresInternalField } of getters) {
      const held = withoutModifiers(type);
      if (web && declaresInternalField && held instanceof ClassType && held.web)
        this.internalFieldInterfaces.set(internalField!, held);
    }
    for (const { name, type, internalField } of web ? getters : []) {
      const held = withoutModifiers(type);
      assert(
        internalField === undefined ||
          !(held instanceof ClassType) ||
          this.holderOfField(internalField)?.internalFieldInterfaces.get(internalField) === held,
        `${name}: declare internalFields: { ${internalField}: b.ref("${(held as ClassType).name}") }`,
      );
    }
    for (const { name, internalField } of [...getters, ...this.internalFieldAccessors]) {
      assert(
        internalField === undefined || this.holderOfField(internalField),
        `${name}: there is no internal field ${internalField}`,
      );
      assert(
        internalField === undefined || !this.internalFieldClasses.has(internalField),
        `${name}: ${internalField} is a b.cell field, which only C++ reads and writes`,
      );
    }
    for (const field of this.internalFields)
      assert(/^[a-z][A-Za-z0-9]*$/.test(field), `${field}: an internal field is named in camelCase`);
    assert(web || !this.base || this.internalFields.length === 0, "cache: a class with extends adds no internal field");
    assert(
      web || !this.base || !this.methods.some(method => method.calledFromCpp),
      "calledFromCpp: a class with extends declares no C++ member function",
    );
    // A `rustName` may be another member's function. A class and its subclasses have one struct.
    const rustFunctions = [
      ...(this.base && !web ? this.root.#rustFunctions : ["constructor"]),
      ...this.methods.filter(method => method.hasDefaultRustName).map(method => method.rustName),
      ...[...getters, ...this.staticGetters]
        .filter(getter => getter.hasDefaultRustName && !getter.family)
        .flatMap(getter => [getter.rustName, ...(getter.hasSetter ? [getter.setterRustName] : [])]),
    ];
    assertDistinct(rustFunctions, "members' Rust functions");
    this.root.#rustFunctions = rustFunctions;
    assertDistinct(this.internalFields.map(snakeCase), "internal fields");
    assertDistinct(
      [...this.methods.filter(method => method.calledFromCpp), ...this.calledFromRust].map(member => member.name),
      "C++ member functions",
    );
    assert(
      !this.forBind ||
        (this.internalFieldAccessors.length === 0 && getters.every(getter => !getter.hasSetter && !getter.writable)),
      "forBind: a member is a function or a getter without a setter",
    );
    for (const signature of web ? [...this.methods, ...this.constructors] : []) signature.isWeb = true;
    this.configurable = options.configurable ?? false;
    this.enumerable = options.enumerable ?? true;
    this.writable = options.writable ?? true;
    this.prototypeBase = options.prototypeBase;
  }
  get rustPath(): string {
    return this.#rustPath ?? `crate::generated_bindgen::${this.origin!.rustModule}::${this.name}`;
  }
  /** Of an interface: the struct is hand-written. */
  get hasOwnStruct(): boolean {
    return this.#rustPath !== undefined;
  }
  /** It or the class up its chain that declares the field. */
  holderOfField(field: string): ClassType | undefined {
    return this.internalFields.includes(field) ? this : this.base?.holderOfField(field);
  }
  membersInTable = true;
  /** What JavaScript calls it. */
  get jsName(): string {
    return this.web?.options.name ?? this.name;
  }
  /** The class that declares the struct and the fields: the base of its base, and so on. */
  get root(): ClassType {
    return this.base?.root ?? this;
  }
  get dependencies(): readonly Type[] {
    return this.base ? [this.base] : [];
  }
  /** The prototype's and the constructor's functions, `call` and `callInstance`. */
  get nativeFunctions(): readonly FunctionDefinition[] {
    return [
      ...this.functions,
      ...this.staticFunctions,
      ...(this.call ? [this.call] : []),
      ...(this.callInstance ? [this.callInstance] : []),
    ];
  }
  /** `construct`, or its overloads. */
  get constructors(): readonly Signature[] {
    return this.web?.constructorOverloads?.signatures ?? (this.construct ? [this.construct] : []);
  }
  /** Every signature that a Rust function implements. */
  get methods(): readonly Method[] {
    return [...this.nativeFunctions.flatMap(fn => fn.signatures as readonly Method[]), ...this.calledFromCpp];
  }
  get cpp(): string {
    if (this.web && this.web.kind !== "interface") return this.base!.cpp;
    return `Bun::Bindgen::Generated::JS${this.name}`;
  }
  getHeaders(out: Set<string>): void {
    if (!this.web) return super.getHeaders(out);
    assert(this.origin, `b.ref(${JSON.stringify(this.name)}): no file exports that interface`);
    out.add("GeneratedBindings+Interfaces.h");
  }
  get directForm(): DirectForm | null {
    if (!this.web || !this.isInTableOfBuiltins) return null;
    return { value: "Value", cppType: "JSC::JSCell*", type: this.parameterType.accepted };
  }
  get idlType(): string {
    return this.refCounted
      ? `Bun::Bindgen::IDLWrappedInterface<${this.cpp}, std::to_array("${this.name}")>`
      : `Bun::Bindgen::IDLRawInterface<${this.cpp}>`;
  }
  get valueKinds(): ValueKinds {
    return [this];
  }
  /** Not what has no instances of its own. The table has no words for an instance that is callable and is no function. */
  get isInTableOfBuiltins(): boolean {
    if (!this.web) return !this.callInstance || this.protoMembers.length > 0;
    const { abstract, namespace, callbackInterface, ofModule, global } = this.web.options;
    const isNeeded = this.membersInTable || ofModule || global || this.hasSubclassInTable;
    if (!isNeeded && this.membersThatHideRows.length === 0) return false;
    return !abstract && !namespace && !callbackInterface && !this.hasCallableInstances && !this.isBehindInstance;
  }
  /** Scripts hold an object of the class that it extends. */
  get isBehindInstance(): boolean {
    return ["AbortController", "AbortSignal", "EventTarget", "WritableStream"].includes(this.prototypeBase!);
  }
  private get membersOfPrototype(): ClassMember[] {
    const { options, partials } = this.web!;
    return [this, ...(options.includes ?? []), ...partials].flatMap(holder => holder.protoMembers);
  }
  /** The compiler would take them for what the table has of an interface that this one extends. */
  get membersThatHideRows(): ClassMember[] {
    const inherited = new Set<string>();
    for (let base = this.base; base; base = base.base)
      if (base.membersInTable) for (const { name } of base.membersOfPrototype) inherited.add(name);
    return this.membersOfPrototype.filter(member => inherited.has(member.name));
  }
  private get hasSubclassInTable(): boolean {
    return this.web!.subclasses.some(it => it.isInTableOfBuiltins || it.hasSubclassInTable);
  }
  private get hasCallableInstances(): boolean {
    return !!this.callInstance || !!this.base?.hasCallableInstances;
  }
  get parameterType(): ParameterType {
    return strictType(this.isInTableOfBuiltins ? instanceType(this.name) : { type: "Object" });
  }
  get resultType(): TypeSpec {
    return this.hasCallableInstances && !this.isInTableOfBuiltins ? { type: "Anything" } : super.resultType;
  }
  /** The table knows what it does not have as any object. */
  get canRefuse(): boolean {
    return !!this.web && !this.isInTableOfBuiltins;
  }
  get holdsJSValue(): boolean {
    return true;
  }
  /** What points into the cell of an interface is on the stack, where it holds the cell. */
  get borrowsCell(): boolean {
    return !this.web;
  }
  get tryConvertThrows(): boolean {
    return false;
  }
  get nullRepresentation() {
    return "pointer" as const;
  }
  get specialOperations(): Getter[] {
    return [this.web?.indexed, this.web?.named].filter(it => it !== undefined);
  }
  get keyedAccessors(): Getter[] {
    return [...this.specialOperations, ...(this.web?.attributesByName ? [this.web.attributesByName] : [])];
  }
  /** The legacy factory functions. */
  get factories(): Signature[] {
    return [...(this.web?.factories.values() ?? [])];
  }
  /** Signatures are not dependencies: a class may mention itself. */
  get signatureTypes(): Type[] {
    return [
      ...this.keyedAccessors.flatMap(getter => [getter.type, getter.setterType]),
      ...(this.web?.collectionTypes ?? []),
      ...this.factories.flatMap(signature => signature.args.map(arg => arg.type)),
      ...this.constructors.flatMap(signature => signature.args.map(arg => arg.type)),
      ...this.methods.flatMap(method => [...method.args.map(arg => arg.type), method.returns]),
      ...[...this.getters, ...this.staticGetters].flatMap(getter => [getter.type, getter.setterType]),
    ];
  }
  get elementTest() {
    if (!this.web) return null;
    return (value: string) => `<${this.rustPath} as bindgen::JsInterface>::is(${value})`;
  }
  get unionCategory(): UnionCategory {
    return "kind";
  }
  layout(): Layout {
    return { size: 8, align: 8 };
  }
  rustExternType(): string {
    return "*mut core::ffi::c_void";
  }
  rustType(): string {
    return `&'a ${this.rustPath}`;
  }
  rustFromExtern(expr: string): string {
    if (this.refCounted) return `bindgen::class_ref_from_extern::<${this.rustPath}>(${expr}, heap)`;
    return `bindgen::JsWrapper::<${this.rustPath}>::from_extern(core::ptr::NonNull::new_unchecked(${expr}), heap).payload_ref()`;
  }
  rustToJS(value: string): string {
    if (this.web) return `bindgen::to_js::instance::<${this.rustPath}>(${value})`;
    return `bindgen::to_js::any(heap, ${value})`;
  }
}

// ───────────────────────────── WebIDL ─────────────────────────────

export interface InterfaceOptions extends Omit<
  ClassOptions,
  "construct" | "refCounted" | "finalize" | "final" | "overridesToJS" | "forBind" | "protoCaller" | "mutator"
> {
  /** What JavaScript calls it, if that is not what it is exported as. */
  name?: string;
  /** `size_of` the struct. A subclass that has internal fields puts them behind it. */
  size?: number;
  /** An instance holds its first two own properties in its cell. Only for an interface that extends none. */
  inlineCapacity?: 2;
  includes?: readonly ClassType[];
  /** On the prototype and on the constructor. */
  constants?: Record<string, number>;
  /** Absent: `new` throws `Illegal constructor`. */
  construct?: ConstructOptions | readonly ConstructOptions[];
  /** An exception to `isCold` of `b.module`. */
  isCold?: false;
  /** As `b.module` has it, for this interface alone. */
  membersInTable?: boolean;
  /** It only has a struct and fields for its subclasses: there is no prototype and no constructor. */
  abstract?: boolean;
  /** `[LegacyNoInterfaceObject]`. */
  noInterfaceObject?: boolean;
  /** A module exports it. It cannot be found by its name, which a web interface may have too. */
  ofModule?: boolean;
  /** `[Global]`: an instance stands behind a global object, which is what JavaScript sees. */
  global?: boolean;
  /** Of a `global` interface: a C++ function that makes what lies between its prototype and that of its base, from the realm and the latter. */
  namedPropertiesObject?: string;
  exposed?: Exposure;
  secure?: boolean;
  /** `indexed_get(index) -> Option<T>` and `indexed_set(index, value)`. The indices are those below what `length` returns. */
  indexed?: SpecialOperations & {
    /** The Rust method that takes `&self` alone. Defaults to `get_length`. */
    length?: string;
  };
  /** `named_get(name) -> Option<T>`, `named_set(name, value)`, `named_delete(name)` and `named_keys(names)`. */
  named?: SpecialOperations & {
    deleter?: true;
    /** `[LegacyOverrideBuiltIns]`. */
    overrideBuiltIns?: true;
    /** With `overrideBuiltIns`: Rust calls `heap.announce_named_property()` for a name that appears, so reading a member stays cacheable. */
    announcesNames?: true;
    /** `[LegacyUnenumerableNamedProperties]`. */
    unenumerable?: true;
  };
  /** `"values"` is `iterable<T>`: the functions of `Array.prototype`. What is `indexed` has `@@iterator` without it. */
  iterable?: "values";
  /** The entries are in a `Map` or a `Set`, `js_X::backing()`. A member that `proto` declares replaces the generated one. */
  maplike?: CollectionOptions & { key: Type };
  setlike?: CollectionOptions;
  /** `[Default] object toJSON()`. */
  defaultToJSON?: true;
  /** More names for a function of the prototype: `{ "@@iterator": "entries" }`. */
  sameFunction?: Record<string, string>;
  /** An attribute for each of `attribute_names(names)`, all with `attribute_get(name)` and `attribute_set(name, value)`. */
  attributesByName?: SpecialOperations;
  /** `[LegacyFactoryFunction]`, by name. `rustName` defaults to `new_` and the name. */
  legacyFactory?: Record<string, ConstructOptions>;
  /** A WebIDL namespace: an object with the `static` members. */
  namespace?: true;
  /** The function that has the constants of a callback interface. A value of the type is a `b.object`. */
  callbackInterface?: true;
  /** `[Serializable]`: `serialize(&self, cx, for_storage)` returns what is cloned in its place, and `deserialize(cx, clone)` gets the clone. */
  serializable?: true;
  /** `document.all`. */
  masqueradesAsUndefined?: true;
  /** `[LegacyWindowAlias]`. */
  aliases?: readonly string[];
}
const interfaceKeys = [
  "name",
  "size",
  "inlineCapacity",
  "includes",
  "constants",
  "isCold",
  "membersInTable",
  "abstract",
  "noInterfaceObject",
  "ofModule",
  "global",
  "namedPropertiesObject",
  "exposed",
  "secure",
  "aliases",
  "indexed",
  "named",
  "iterable",
  "masqueradesAsUndefined",
  "maplike",
  "setlike",
  "defaultToJSON",
  "sameFunction",
  "attributesByName",
  "legacyFactory",
  "namespace",
  "callbackInterface",
  "serializable",
] as const;

export interface CollectionOptions {
  value: Type;
  readonly?: true;
  /** Rust brings the entries up to date: `prepare_entries(&self, heap)` runs before each generated member. */
  prepare?: true;
}

export type SpecialOperations = Pick<GetterField, "getter" | "setter" | "capability" | "throws" | "ceReactions">;

export interface MixinOptions extends Pick<ClassOptions, "proto" | "rustTraits"> {
  /** What all that include it extend. */
  on: ClassType;
  constants?: Record<string, number>;
  exposed?: Exposure;
  secure?: boolean;
}

export interface FamilyOptions extends Omit<GetterField, "rustName" | "cache" | "field"> {
  /** What all that have a member of it extend. */
  on: ClassType;
  /** The Rust type of what tells the members apart. Without it they get their name, share their functions, and have no row in the table of built-ins. */
  key?: string;
}

export class WebInterface {
  readonly declaredName: string;
  readonly kind: "interface" | "mixin" | "family";
  readonly options: InterfaceOptions;
  readonly subclasses: ClassType[] = [];
  constructorOverloads: FunctionDefinition | undefined;
  indexed: Getter | undefined;
  named: Getter | undefined;
  attributesByName: Getter | undefined;
  readonly factories = new Map<string, Signature>();
  collectionTypes: Type[] = [];
  readonly partials: ClassType[] = [];
  /** Of a family. */
  accessor: GetterField | undefined;
  keyType: string | undefined;
  readonly keys: string[] = [];
  /** Its place in the array of ClassInfos, where its subclasses follow it, and how many places they all take. Set by the generator. */
  number = -1;
  span = 0;
  constructor(declaredName: string, kind: WebInterface["kind"], options: InterfaceOptions) {
    this.declaredName = declaredName;
    this.kind = kind;
    this.options = options;
  }
}

const interfacesByName = new Map<string, ClassType>();

export function interfaceNamed(name: string): ClassType {
  let type = interfacesByName.get(name);
  if (!type) {
    interfacesByName.set(name, (type = new ClassType()));
    type.name = name;
  }
  return type;
}

const constantFields = (constants: Record<string, number> = {}) =>
  Object.fromEntries(
    Object.entries(constants).map(([name, constant]) => [name, { constant, configurable: false }] as const),
  );

export function defineInterface(name: string, options: InterfaceOptions): ClassType {
  const type = interfaceNamed(name);
  assert(!type.web!.declaredName, `${name} is declared twice`);
  const web = (type.web = new WebInterface(name, "interface", options));
  const base = options.extends;
  assert(!base || base.web?.declaredName, `${name}: extends an interface, imported from the file that declares it`);
  assert(!base || !options.inlineCapacity, `${name}: inlineCapacity is for an interface that extends none`);
  assert(!base || base.web!.options.abstract || !options.prototypeBase, `${name}: extends or prototypeBase`);
  assert(
    options.prototypeBase !== "DOMException" ||
      (!base && options.abstract && options.rustPath && !options.internalFields && !options.inlineCapacity),
    `${name}: DOMException is the base of an abstract interface without fields, whose struct starts with a bindgen::DomException`,
  );
  assert(
    options.size === undefined || (options.rustPath && options.size % 8 === 0),
    `${name}: size is that of rustPath, a multiple of 8`,
  );
  base?.web!.subclasses.push(type);
  const includes = options.includes ?? [];
  for (const mixin of includes) {
    assert(mixin.web?.kind === "mixin", `${name}: includes takes what b.mixin makes`);
    let on = base;
    while (on && on !== mixin.base) on = on.base;
    assert(on, `${name}: ${mixin.name} is for what extends ${mixin.base!.name}`);
  }
  const constants = constantFields(
    Object.assign({}, options.constants, ...includes.map(mixin => mixin.web!.options.constants)),
  );
  const constructors: readonly ConstructOptions[] = options.construct ? [options.construct].flat() : [];
  const hasInterfaceObject = !options.abstract && !options.noInterfaceObject;
  assert(hasInterfaceObject || constructors.length === 0, `${name}: there is no constructor object`);
  assert(!options.abstract || !options.proto, `${name}: the members of an abstract interface are in mixins`);
  const omitted = (args: Record<string, Type> = {}) => Object.values(args).findLastIndex(type => !type.isOmittable) + 1;
  const collection = options.maplike ?? options.setlike;
  web.collectionTypes = [options.maplike?.key, collection?.value].filter(it => it !== undefined);
  web.collectionTypes.forEach(markAsElement);
  type.define({
    configurable: true,
    ...columnsOf(options, interfaceKeys),
    ...(collection && {
      internalFields: Array.isArray(options.internalFields)
        ? [...options.internalFields, "backing"]
        : { ...options.internalFields, backing: new AnyType() },
    }),
    final: false,
    construct: hasInterfaceObject ? (constructors[0] ?? "illegal") : undefined,
    proto: { ...options.proto, ...constants },
    static: hasInterfaceObject ? { ...options.static, ...constants } : undefined,
  });
  if (constructors.length > 1)
    web.constructorOverloads = new FunctionDefinition(
      constructors.map(it => new Signature({ requiredArguments: omitted(it.args), ...it })),
      {},
      false,
      true,
    );
  for (const kind of ["indexed", "named"] as const) {
    if (!options[kind]) continue;
    const { getter, setter, capability, throws, ceReactions } = options[kind];
    assert(
      !(getter instanceof OptionalType),
      `${name}: ${kind}_get returns an Option of the type that is written here`,
    );
    web[kind] = new Getter(`${kind}Property`, { getter, setter, capability, throws, ceReactions }, false, true, true);
  }
  if (options.attributesByName)
    web.attributesByName = new Getter("attributeByName", options.attributesByName, false, true, true);
  for (const [factory, it] of Object.entries(options.legacyFactory ?? {})) {
    const { passStructure, ...rest } = it;
    assert(
      !!passStructure === type.passStructure || it.passNewTarget,
      `${factory}: passStructure is as construct has it`,
    );
    const rustName = `new_${snakeCase(factory)}`;
    web.factories.set(factory, new Signature({ requiredArguments: omitted(it.args), rustName, ...rest }));
  }
  for (const signature of [...type.constructors, ...web.factories.values()]) signature.isWeb = true;
  for (const member of type.protoMembers)
    assert(
      !includes.some(mixin => mixin.protoMembers.some(other => other.name === member.name)),
      `${name}.${member.name} is in a mixin too`,
    );
  return type;
}

export function defineMixin(name: string, { on, constants, exposed, secure, ...options }: MixinOptions): ClassType {
  const type = new ClassType();
  type.name = name;
  type.web = new WebInterface(name, "mixin", { constants, exposed, secure });
  assert(on.web?.declaredName, `${name}: on is an interface, imported from the file that declares it`);
  type.define({ configurable: true, ...options, extends: on, final: false });
  assert(type.internalFields.length === 0, `${name}: a mixin has no fields: cache names one of ${on.name}`);
  return type;
}

export function definePartial(name: string, options: MixinOptions): ClassType {
  const type = defineMixin(name, options);
  includeMixin(options.on, type);
  return type;
}

export function includeMixin(type: ClassType, mixin: ClassType): void {
  let on: ClassType | undefined = type;
  while (on && on !== mixin.base) on = on.base;
  assert(on, `${type.name}: ${mixin.name} is for what extends ${mixin.base!.name}`);
  assert(!mixin.web!.options.constants, `${type.name}: ${mixin.name} has constants, so write it in includes`);
  type.web!.partials.push(mixin);
  type.web!.partials.sort((left, right) => (left.name < right.name ? -1 : 1));
}

export function defineFamily(name: string, { on, key, ...accessor }: FamilyOptions) {
  const type = new ClassType();
  type.name = name;
  const web = (type.web = new WebInterface(name, "family", {}));
  assert(on.web?.declaredName, `${name}: on is an interface, imported from the file that declares it`);
  web.accessor = accessor;
  web.keyType = key;
  type.define({ configurable: true, extends: on, final: false, proto: { value: accessor } });
  return Object.assign(type, {
    /** `key` is a constant Rust expression. `setter: undefined` leaves the family's setter out. */
    of(key = "", options: Partial<GetterField> = {}): FamilyMember {
      assert(!!key === !!web.keyType, `${name}.of takes a key if, and only if, the family has a type for it`);
      const known = web.keys.indexOf(key);
      return new FamilyMember(type, known >= 0 ? known : web.keys.push(key) - 1, options);
    },
  });
}

export interface NamespaceOptions extends EntryColumns {
  /** The object is itself a function, named as the namespace is, that does what this one of its functions does. */
  call?: string;
}

/** A plain object whose properties are native functions, as WebIDL's `namespace`. With `call`, a function that has them. */
export class NamespaceDefinition {
  readonly functions: readonly FunctionDefinition[];
  readonly call: FunctionDefinition | undefined;
  readonly columns: EntryColumns;
  name = "";
  constructor(
    functions: Record<string, SignatureOptions | readonly SignatureOptions[]>,
    options: NamespaceOptions = {},
  ) {
    this.columns = columnsOf(options, ["call"]);
    this.functions = Object.entries(functions).map(([name, options]) => {
      assert(/^[A-Za-z_$][\w$]*$/.test(name), `${name}: a function is named by an identifier`);
      assert(!(options instanceof FunctionDefinition), `${name}: write what b.fn takes, without b.fn`);
      const signatures: readonly SignatureOptions[] = Array.isArray(options) ? options : [options];
      for (const key of ["passThis", "passCallee", "export", "feature"])
        assert(!signatures.some(signature => key in signature), `${name}: a function of a namespace has no ${key}`);
      const fn = new FunctionDefinition(signatures);
      fn.name = name;
      return fn;
    });
    assert(this.functions.length > 0, "a namespace with no functions");
    this.call = this.functions.find(fn => fn.name === options.call);
    assert(options.call === undefined || this.call, `call: ${options.call} is not one of its functions`);
  }
}

export interface ModuleOptions {
  /** Rust path the file's functions live under, e.g. `crate::node::node_os`. */
  rustPath?: string;
  /** The Rust module whose `enter` and `leave` go around a member with `ceReactions`. */
  ceReactions?: string;
  /** The feature that `bun build --compile --trim` removes the file's interfaces with, and what `$bindgen` takes from it. */
  feature?: string;
  /** false: the table of built-ins has the file's classes and not their members, which compiled code then calls as it calls any native function. A member is about 450 bytes there. It does not have an interface either, unless something that it has depends on it. */
  membersInTable?: boolean;
  /** Its glue is made for size: members that convert alike share a function. A call costs a few more jumps. */
  isCold?: boolean;
}

export class ModuleDefinition {
  readonly rustPath: string | undefined;
  readonly ceReactions: string | undefined;
  readonly membersInTable: boolean;
  readonly isCold: boolean;
  readonly feature: string | undefined;
  constructor(options: ModuleOptions) {
    this.rustPath = options.rustPath;
    this.ceReactions = options.ceReactions;
    this.membersInTable = options.membersInTable ?? true;
    this.isCold = options.isCold ?? false;
    this.feature = options.feature;
  }
}
