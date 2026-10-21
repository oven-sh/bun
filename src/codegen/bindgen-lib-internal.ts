// The type model behind `bindgen-lib.ts`.

import assert from "node:assert";
import util from "node:util";

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

function assertDistinct(names: readonly string[], what: string): void {
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
  | JSClass;

/** The instances of a C++ `JSCell` class. */
export interface JSClass {
  readonly cpp: string;
}

type ValueKinds = readonly ValueKind[] | "any";

const isSameKind = (a: ValueKind, b: ValueKind) =>
  a === b || (a instanceof ClassRefType && b instanceof ClassRefType && a.cpp === b.cpp);

const takes = (type: Type, kind: ValueKind | "other") =>
  type.valueKinds === "any" || (kind !== "other" && type.valueKinds.some(own => isSameKind(own, kind)));

const distinguishingKinds = (types: readonly Type[]): (ValueKind | "other")[] => [
  ...types
    .flatMap(type => (type.valueKinds === "any" ? [] : type.valueKinds))
    .filter((kind, index, kinds) => kinds.findIndex(earlier => isSameKind(earlier, kind)) === index),
  "other",
];

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
      }
      if (!lists.has(`${list}`)) lists.set(`${list}`, list);
      return [kind, lists.get(`${list}`)!];
    }),
  );
}

export function indent(text: string, by: number): string {
  const pad = " ".repeat(by);
  return text
    .split("\n")
    .map(line => (line.length > 0 ? pad + line : line))
    .join("\n");
}

const cppThenCheck = (statement: string, check: string) => (check ? `${statement}\n${check}` : statement);

/** C++ statements that engage `optional`, a `std::optional`, then fill what it holds: `fill` is given a name for that. */
export function cppEmplace(optional: string, fill: (target: string) => string): string {
  const [first, ...rest] = optional.split(/\W+/);
  const target = `${first}${rest.map(part => part[0].toUpperCase() + part.slice(1)).join("")}Value`;
  return `auto& ${target} = ${optional}.emplace();\n${fill(target)}`;
}

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
  /** Value to use when absent. Only for arguments and dictionary members. */
  default(value: unknown): DefaultType {
    return new DefaultType(this, value);
  }

  /** The C++ tag type whose `WebCore::Converter` turns a JSValue into a C++ value. */
  abstract readonly idlType: string;
  /** TypeScript spelling of the values it takes: `any` where the conversion coerces. */
  abstract readonly tsType: string;

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
  /** Written `.optional`, `.nullable`, `.falsyAsNull`, `.emptyStringAsNull` or `.default()`: as an argument with only such after it, it is one a caller leaves out. */
  get isOptional(): boolean {
    return false;
  }
  /** The host function passes the argument itself along: `ExternWithValue`. Only for an argument. */
  get passesValue(): boolean {
    return false;
  }
  /** `rustFromExtern` is a `bindgen::Result`. Only for an argument. */
  get rustFromExternThrows(): boolean {
    return false;
  }
  /** Converting can throw, so an exception check follows. */
  get conversionThrows(): boolean {
    return true;
  }
  /** Holds a JS value: the Rust type is branded with the call. */
  get holdsJSValue(): boolean {
    return this.dependencies.some(type => type.holdsJSValue);
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
  /** A C++ expression that converts `value`. `ctx` is a conversion context, `name` what to call the value. */
  cppConvert(value: string, ctx: string, name: string): string {
    return `Bun::convertIDL<${this.idlType}>(*globalObject, ${value}, ${ctx})`;
  }
  /** C++ lines for once every argument is converted. They read into `target`, converted from `value`, what converting a later argument could have changed. */
  cppReadLast(target: string, value: string): string[] {
    return [];
  }
  /** Large, or holds something large: built where it ends up, not returned and moved there. */
  get convertsInPlace(): boolean {
    return false;
  }
  /** C++ statements that convert `value` into `target`, just default-constructed. `check` returns if an exception is pending and follows what can throw; a caller that returns next passes "". */
  cppConvertInto(target: string, value: string, ctx: string, name: string, check: string): string {
    return cppThenCheck(`${target} = ${this.cppConvert(value, ctx, name)};`, this.conversionThrows ? check : "");
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
}

// ───────────────────────────── primitives ─────────────────────────────

class PrimitiveType extends Type {
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
  toCpp(value: unknown): string {
    if (this.rustName === "bool") {
      assert(typeof value === "boolean", `${util.inspect(value)} is not a boolean`);
      return String(value);
    }
    assert(typeof value === "number", `${util.inspect(value)} is not a number`);
    assert(Number.isFinite(value), `${value} is not finite`);
    if (this.rustName !== "f64") assert(Number.isSafeInteger(value), `${value} is not an integer`);
    return `${this.cppName} { ${value} }`;
  }
  toRust(value: unknown): string {
    return this.rustName === "f64" ? `${value}_f64` : String(value);
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
}

/** What a body returns and nothing takes, so it has no C++ type. */
export abstract class ResultType extends Type {
  readonly idlType = "";
  /** What a schema that takes one is told. */
  abstract readonly refusal: string;
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
  get loose(): never {
    throw new TypeError(`.${this.modifier}() says how the value converts; .loose is another way`);
  }
  get wrap(): never {
    throw new TypeError(`.${this.modifier}() says how the value converts; .wrap is another way`);
  }
  getHeaders(out: Set<string>): void {
    out.add("Bindgen/IDLConvertIntegerRange.h");
  }
  cppConvert(value: string, ctx: string, name: string): string {
    const reported = this.modifier === "validateInteger" ? `, ${asciiLiteral(name)}` : "";
    return `WebCore::Converter<${this.idlType}>::convert(*globalObject, ${value}${reported})`;
  }
}

const integer = (rust: string, cpp: string, size: number, webidl: string, min: number | bigint, max: number | bigint) =>
  new IntegerType({ rust, cpp, size, webidl, min, max });

export const integers = {
  u8: integer("u8", "uint8_t", 1, "IDLOctet", 0, 255),
  u16: integer("u16", "uint16_t", 2, "IDLUnsignedShort", 0, 65535),
  i32: integer("i32", "int32_t", 4, "IDLLong", -2147483648, 2147483647),
  u32: integer("u32", "uint32_t", 4, "IDLUnsignedLong", 0, 4294967295),
  u64: integer("u64", "uint64_t", 8, "IDLUnsignedLongLong", 0, Number.MAX_SAFE_INTEGER),
  usize: integer("usize", "uint64_t", 8, "IDLUnsignedLongLong", 0, Number.MAX_SAFE_INTEGER),
};

export class DoubleType extends PrimitiveType {
  constructor(idlType = "Bun::Bindgen::IDLStrictDouble", valueKinds: ValueKinds = ["number"]) {
    super(idlType, valueKinds === "any" ? "any" : "number", "f64", 8, valueKinds);
  }
  /** As a result: a `Date` with that time value. */
  get asDate(): DateResultType {
    assert(this.idlType === "Bun::Bindgen::IDLStrictDouble", ".asDate follows b.f64");
    return new DateResultType();
  }
  /** `ToNumber`: WebIDL's `unrestricted double`. */
  get loose(): LooseDoubleType {
    return new LooseDoubleType("WebCore::IDLUnrestrictedDouble", "any");
  }
}

export class LooseDoubleType extends DoubleType {
  /** `ToNumeric`: a BigInt too, as the double nearest to it, for an argument whose type is `number | bigint`. */
  get allowBigInt(): DoubleType {
    return new DoubleType("Bun::Bindgen::IDLLooseDoubleOrBigInt", "any");
  }
}

export class DateResultType extends ResultType {
  readonly tsType = "Date";
  readonly refusal = ".asDate is a result";
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
    this.idlType = unit === "null" ? "Bun::Bindgen::IDLStrictNull" : "";
  }
  get tsType(): string {
    return this.unit === "null" ? "null | undefined" : "undefined";
  }
  get valueKinds(): ValueKinds {
    return this.unit === "null" ? ["undefined", "null"] : ["undefined"];
  }
  get takesUndefined(): boolean {
    return true;
  }
  cppConvert(): string {
    throw new TypeError(`b.${this.unit} is only an alternative of a union`);
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
  /** As a result: the JS string, which the body made. */
  get local(): LocalStringResultType {
    assert(this.idlType === "Bun::Bindgen::IDLStrictString", ".local follows b.string");
    return new LocalStringResultType();
  }
  get nullRepresentation() {
    return "pointer" as const;
  }
  toCpp(value: unknown): string {
    assert(typeof value === "string", `${util.inspect(value)} is not a string`);
    return `WTF::String { ${asciiLiteral(value)} }`;
  }
  toRust(value: unknown): string {
    return value === "" ? "bun_core::String::EMPTY" : `bun_core::String::static_(${JSON.stringify(value)})`;
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
}

export class LocalStringResultType extends ResultType {
  readonly tsType = "string";
  readonly refusal = ".local is a result";
  get holdsJSValue(): boolean {
    return true;
  }
  rustType(): string {
    return "bindgen::JsLocal<'a, bun_jsc::JSString>";
  }
  rustToJS(value: string): string {
    return `bindgen::to_js::any(heap, ${value})`;
  }
}

/** UTF-8 to keep: the JS string's own buffer, shared, when it is 8-bit ASCII, otherwise a transcoded copy. */
export class OwnedUtf8Type extends StringType {
  get loose(): never {
    throw new TypeError("write b.string.loose.utf8.owned");
  }
  get allowStringObject(): never {
    throw new TypeError("b.string.utf8.owned already takes a String object");
  }
  get utf8(): never {
    throw new TypeError("b.string.utf8.owned is already UTF-8");
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

/** UTF-8 bytes for the duration of the call: `Bun::Bindgen::JSStringUTF8View`. */
export class Utf8Type extends Type {
  readonly isLoose: boolean;
  constructor(isLoose: boolean) {
    super();
    this.isLoose = isLoose;
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
  get borrowsFrame(): boolean {
    return true;
  }
  get nullRepresentation() {
    return "pointer" as const;
  }
  get convertsInPlace(): boolean {
    return true;
  }
  cppConvertInto(target: string, value: string, ctx: string, name: string, check: string): string {
    return cppThenCheck(
      `WebCore::Converter<${this.idlType}>::convertInto(*globalObject, ${value}, ${ctx}, ${target}, "a string"_s);`,
      check,
    );
  }
  cppAssign(target: string, value: unknown): string {
    assert(typeof value === "string", `${util.inspect(value)} is not a string`);
    return `${target}.initialize(${asciiLiteral(value)});`;
  }
  toRust(value: unknown): string {
    return `b${JSON.stringify(value)}`;
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
    const spelling = { string: "string", buffer: "ArrayBuffer | SharedArrayBuffer | ArrayBufferView", blob: "Blob" };
    return this.#options.from.map(kind => spelling[kind]).join(" | ");
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
  cppConvertInto(target: string, value: string, ctx: string, name: string, check: string): string {
    const spelling = { string: ["a string"], buffer: ["ArrayBuffer", "ArrayBufferView"], blob: ["Blob"] };
    const expected = (["string", "buffer", "blob"] as const)
      .filter(kind => this.#options.from.includes(kind))
      .flatMap(kind => spelling[kind]);
    if (!this.#options.from.includes("string")) expected[0] = `${/^A/.test(expected[0]) ? "an" : "a"} ${expected[0]}`;
    const last = expected.pop();
    const list = expected.length > 0 ? `${expected.join(", ")} or ${last}` : last!;
    const convert = `WebCore::Converter<${this.idlType}>::convertInto(*globalObject, ${value}, ${ctx}, ${target}, ${asciiLiteral(list)})`;
    return check ? `if (${convert})\n    ${check}` : `${convert};`;
  }
  cppReadLast(target: string, value: string): string[] {
    if (!this.#isView) return [];
    if (this.#options.shared === "copied")
      return [
        `WTF::MallocSpan<uint8_t> ${target}Copy;`,
        `if (${target}.${this.#options.held === "borrowed" ? "readCopyingShared" : "copyIfShared"}(*globalObject, ${value}, ${target}Copy)) [[unlikely]]`,
        `    RETURN_IF_EXCEPTION(scope, {});`,
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
    );
  }
  get holdsJSValue(): boolean {
    return true;
  }
  get returnsValueUnchanged(): boolean {
    return true;
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

/** A function, or a proxy of one, for the body to call or to store. */
export class CallableType extends Type {
  readonly idlType = "Bun::Bindgen::IDLRawCallable";
  readonly tsType = "(...args: any[]) => any";
  get holdsJSValue(): boolean {
    return true;
  }
  get returnsValueUnchanged(): boolean {
    return true;
  }
  layout(): Layout {
    return { size: 8, align: 8 };
  }
  rustExternType(): string {
    return "JSValue";
  }
  rustType(): string {
    return "bindgen::JsLocal<'a, bindgen::Callable>";
  }
  rustFromExtern(expr: string): string {
    return `bindgen::JsLocal::from_extern(${expr}, heap)`;
  }
  rustToJS(value: string): string {
    return `bindgen::to_js::any(heap, ${value})`;
  }
}

export class AnyType extends Type {
  readonly idlType = "Bun::Bindgen::IDLRawAny";
  readonly tsType = "any";
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
  layout(): Layout {
    return { size: 8, align: 8 };
  }
  rustExternType(): string {
    return "JSValue";
  }
  rustType(): string {
    return "bindgen::JsLocal<'a>";
  }
  rustFromExtern(expr: string): string {
    return `bindgen::JsLocal::from_extern(${expr}, heap)`;
  }
  rustToJS(value: string): string {
    return `bindgen::to_js::any(heap, ${value})`;
  }
}

/** A ref-counted native object taken out of its JS wrapper. */
export class RefType extends Type {
  readonly idlType: string;
  readonly tsType: string;
  readonly pointee: string;
  readonly header: string | null;
  readonly #valueKinds: ValueKinds;
  readonly #refuses: string;
  constructor(
    idlType: string,
    tsType: string,
    pointee: string,
    header: string | null,
    valueKinds: ValueKinds,
    refuses: string,
  ) {
    super();
    this.idlType = idlType;
    this.tsType = tsType;
    this.pointee = pointee;
    this.header = header;
    this.#valueKinds = valueKinds;
    this.#refuses = refuses;
  }
  get valueKinds(): ValueKinds {
    return this.#valueKinds;
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

/** What an instance of a class of a `.classes.ts` file wraps, borrowed as `JSValue::as_class_ref` borrows it. */
export class ClassRefType extends Type {
  readonly tsType = "object";
  readonly cpp: string;
  readonly idlType: string;
  readonly rustPath: string;
  constructor(name: string) {
    super();
    this.cpp = `WebCore::JS${name}`;
    this.idlType = `Bun::Bindgen::IDLWrappedInterface<${this.cpp}, std::to_array("${name}")>`;
    this.rustPath = `crate::generated_classes::${name}`;
  }
  get valueKinds(): ValueKinds {
    return [this];
  }
  get refuses() {
    return "instances that wrap nothing";
  }
  /** The `&'a` is branded with the call, as a JS value is. */
  get holdsJSValue(): boolean {
    return true;
  }
  get borrowsCell(): boolean {
    return true;
  }
  get nullRepresentation() {
    return "pointer" as const;
  }
  getHeaders(out: Set<string>): void {
    out.add("ZigGeneratedClasses.h");
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
    return `bindgen::class_ref_from_extern::<${this.rustPath}>(${expr}, heap)`;
  }
}

// ───────────────────────────── combinators ─────────────────────────────

export class OptionalType extends Type {
  readonly inner: Type;
  readonly modifier: "optional" | "nullable" | "falsyAsNull" | "emptyStringAsNull";
  constructor(inner: Type, modifier: OptionalType["modifier"]) {
    super();
    assert(!(inner instanceof OptionalType), "already optional");
    assert(!(inner instanceof DefaultType), "put .default() last");
    if (inner instanceof AnyType) {
      assert(modifier === "emptyStringAsNull", "b.any already accepts undefined and null");
    } else {
      assert(!inner.takesUndefined, `${inner.tsType} already takes undefined`);
    }
    assert(
      !(inner instanceof BytesType) || inner.canBe(modifier),
      'b.bytes can be absent if it is held: "borrowed", and .nullable if it is string: "asIs"',
    );
    this.inner = inner;
    this.modifier = modifier;
  }
  get idlType(): string {
    assert(!(this.inner instanceof RangeType), "a range cannot be absent; give it a .default()");
    const template = {
      optional: "WebCore::IDLOptional",
      nullable: "WebCore::IDLNullable",
      falsyAsNull: "Bun::Bindgen::IDLFalsyAsNull",
      emptyStringAsNull: "Bun::Bindgen::IDLEmptyStringAsNull",
    }[this.modifier];
    return `${template}<${this.inner.idlType}>`;
  }
  get tsType(): string {
    return `${this.inner.tsType} | ${this.modifier === "optional" ? "undefined" : "null | undefined"}`;
  }
  get takesUndefined(): boolean {
    return true;
  }
  get isOptional(): boolean {
    return true;
  }
  get valueKinds(): ValueKinds {
    if (this.inner.valueKinds === "any" || this.modifier === "falsyAsNull" || this.modifier === "emptyStringAsNull")
      return "any";
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
  cppReadLast(target: string, value: string): string[] {
    return this.inner.cppReadLast(target, value);
  }
  /** What converts in place is null when default-constructed. A pointer to a class instance, which does not, is not. */
  cppConvertInto(target: string, value: string, ctx: string, name: string, check: string): string {
    if (!this.convertsInPlace) return super.cppConvertInto(target, value, ctx, name, check);
    const present = {
      optional: `!${value}.isUndefined()`,
      nullable: `!${value}.isUndefinedOrNull()`,
      falsyAsNull: `${value}.toBoolean(globalObject)`,
      emptyStringAsNull: `!Bun::Bindgen::isUndefinedOrNullOrEmptyString(${value})`,
    }[this.modifier];
    const convert = (slot: string) => this.inner.cppConvertInto(slot, value, ctx, name, check);
    const body = this.inner.nullRepresentation === "optional" ? cppEmplace(target, convert) : convert(target);
    return `if (${present}) {\n${indent(body, 4)}\n}`;
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

/** Not a type of its own: marks an argument or member whose absence has a value. */
export class DefaultType extends Type {
  readonly inner: Type;
  readonly value: unknown;
  /** `null` also takes the default. */
  readonly onNull: boolean;
  constructor(inner: Type, value: unknown) {
    super();
    assert(!(inner instanceof DefaultType), "already has a default");
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
  get takesUndefined(): boolean {
    return true;
  }
  get isOptional(): boolean {
    return true;
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
  get valueKinds(): ValueKinds {
    if (this.inner.valueKinds === "any") return "any";
    return [...this.inner.valueKinds, "undefined", ...(this.onNull ? (["null"] as const) : [])];
  }
  private cppIsAbsent(value: string): string {
    return `${value}.${this.onNull ? "isUndefinedOrNull" : "isUndefined"}()`;
  }
  cppConvert(value: string, ctx: string, name: string): string {
    return `${this.cppIsAbsent(value)} ? ${this.toCpp(this.value)} : ${this.inner.cppConvert(value, ctx, name)}`;
  }
  get convertsInPlace(): boolean {
    return this.inner.convertsInPlace;
  }
  cppConvertInto(target: string, value: string, ctx: string, name: string, check: string): string {
    if (!this.convertsInPlace) return super.cppConvertInto(target, value, ctx, name, check);
    return `if (${this.cppIsAbsent(value)}) {
${indent(this.cppAssign(target, this.value), 4)}
} else {
${indent(this.inner.cppConvertInto(target, value, ctx, name, check), 4)}
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

export class ArrayType extends Type {
  get rustIsCopy(): boolean {
    return false;
  }
  readonly element: Type;
  constructor(element: Type) {
    super();
    assert(!(element instanceof DefaultType), "an element of an array is never absent, so it has no default");
    assert(!(element instanceof RangeType), "a range reports the name of its argument, which an element does not have");
    assert(!element.passesValue, "b.bytes is only for an argument");
    assert(
      !element.borrowsCell,
      "b.classRef and a refCounted class cannot be in an array or a dictionary: only an argument's slot in the frame keeps the instance alive",
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
    return `bindgen::to_js::array(heap, ${value}, |heap, value| ${this.element.rustToJS("value", scope)})`;
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

export abstract class NamedType extends Type {
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

export class EnumerationType extends NamedType {
  /** `spellings[i]` all parse to variant `i`; the first is the canonical one. */
  readonly spellings: readonly (readonly string[])[];
  /** Index of the first canonical spelling in `Tables::enumerationValues`. Set by the generator. */
  firstEnumerationValueIndex = -1;
  constructor(values: readonly (string | readonly string[])[]) {
    super();
    assert(values.length > 0, "an enumeration needs at least one value");
    this.spellings = values.map(value => (typeof value === "string" ? [value] : value));
    const all = this.spellings.flat();
    assert(new Set(all).size === all.length, `a value is listed twice: ${all.join(", ")}`);
    assert(
      new Set(this.variants).size === this.variants.length,
      `two values make the same identifier: ${this.variants.join(", ")}`,
    );
    for (const variant of this.variants) assert(/^[A-Z]/.test(rustIdent(variant)), `${variant} is not an identifier`);
  }
  get variants(): string[] {
    return this.spellings.map(([canonical]) => pascalCase(canonical));
  }
  get valueKinds(): ValueKinds {
    return ["string"];
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
}

export class Member {
  readonly names: readonly string[];
  /** Of the field in the generated C++ struct and, keywords aside, in the Rust one. */
  readonly fieldName: string;
  readonly type: Type;
  constructor(name: string, spec: Type | MemberOptions) {
    const options: MemberOptions = spec instanceof Type ? { type: spec } : spec;
    this.names = [name, ...(options.altNames ?? [])];
    for (const name of this.names)
      assert(/^[A-Za-z_$][\w$]*$/.test(name), `${name}: a member is named by an identifier`);
    this.fieldName = options.rustName ?? snakeCase(name);
    assert(/^[a-z_][a-z0-9_]*$/.test(this.fieldName), `${this.fieldName}: rustName is written in snake_case`);
    assert(!cppKeywords.has(this.fieldName), `${this.fieldName} is a C++ keyword: name the field with rustName`);
    this.type = options.type;
  }
  get name(): string {
    return this.names[0];
  }
  get rustName(): string {
    return rustIdent(this.fieldName);
  }
}

export interface DictionaryOptions {
  /** Also generate `Name::from_js`, for Rust that holds a JS value and no typed signature. */
  fromJS?: boolean;
  /** An array is read like any other object, not refused. */
  allowArray?: boolean;
  /**
   * A value that is not an object gives every member its default. With `"typeof"` so does a function: Node's
   * `if (typeof options !== "object") options = null`.
   */
  nonObjectAsEmpty?: boolean | "typeof";
  /** As a result, the object has no prototype. */
  nullPrototype?: boolean;
}

export class DictionaryType extends NamedType {
  readonly options: DictionaryOptions;
  readonly members: readonly Member[];
  /** Index in `Tables::memberNames` of the first name read, and of the first name written. Set by the generator. */
  firstMemberNameIndex = -1;
  firstReturnedMemberNameIndex = -1;
  /** An element of an array: everywhere else it is converted in place. */
  convertedByValue = false;
  constructor(members: Record<string, Type | MemberOptions>, options: DictionaryOptions = {}) {
    super();
    this.options = options;
    this.members = Object.entries(members).map(([name, spec]) => new Member(name, spec));
    assert(this.members.length > 0, "a dictionary needs at least one member");
    assertDistinct(
      this.members.map(member => member.fieldName),
      "fields",
    );
    for (const { name, type } of this.members) assert(!type.passesValue, `${name}: b.bytes is only for an argument`);
    assert(
      !this.borrowsCell,
      "b.classRef and a refCounted class cannot be in an array or a dictionary: only an argument's slot in the frame keeps the instance alive",
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
  get allowArray(): boolean {
    return !!this.options.allowArray;
  }
  get nonObjectAsEmpty(): boolean | "typeof" {
    return this.options.nonObjectAsEmpty ?? false;
  }
  get nullPrototype(): boolean {
    return !!this.options.nullPrototype;
  }
  get idlType(): string {
    return `WebCore::IDLDictionary<${this.cpp}>`;
  }
  get dependencies(): readonly Type[] {
    return this.members.map(member => member.type);
  }
  get convertsInPlace(): boolean {
    return true;
  }
  cppConvertInto(target: string, value: string, ctx: string, name: string, check: string): string {
    return cppThenCheck(`Bun::Bindgen::convertDictionaryInto(*globalObject, ${value}, ${target}, ${ctx});`, check);
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
    return this.members.every(member => member.type.takesUndefined);
  }
  toRust(value: unknown, scope: RustScope): string {
    const given = value as Record<string, unknown>;
    const fields = this.members.map(member => {
      const field = member.type instanceof DefaultType ? member.type.value : undefined;
      return `${member.rustName}: ${member.type.toRust(Object.hasOwn(given, member.name) ? given[member.name] : field, scope)}`;
    });
    return `${this.path(scope, this.name)} { ${fields.join(", ")} }`;
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
  constructor(alternatives: Record<string, Type>) {
    super();
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
      assert(!(type instanceof OptionalType), `${name}: add b.null as an alternative`);
      assert(!(type instanceof DefaultType), `${name}: put .default() on the union`);
      assert(!type.passesValue, `${name}: b.bytes is only for an argument`);
      assert(/^[a-z][A-Za-z0-9]*$/.test(name), `${name}: an alternative is named in camelCase`);
      assert(name !== "tag", "tag: the generated struct has a member of that name");
      assert(!cppKeywords.has(name), `${name} is a C++ keyword, and JavaScript never sees the name: pick another`);
      assert(
        !(type instanceof RangeType),
        `${name}: a range reports the name of its argument, which a union does not know`,
      );
    }
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
  get alternativesByKind() {
    return alternativesByKind(this.alternatives.map(a => a.type));
  }
  get valueKinds(): ValueKinds {
    const kinds = distinguishingKinds(this.alternatives.map(a => a.type)).filter(kind => kind !== "other");
    return this.alternatives.some(a => a.type.valueKinds === "any") ? "any" : kinds;
  }
  get idlType(): string {
    return `Bun::Bindgen::IDLTaggedUnion<${this.cpp}>`;
  }
  get convertsInPlace(): boolean {
    return true;
  }
  cppConvertInto(target: string, value: string, ctx: string, name: string, check: string): string {
    return cppThenCheck(
      `WebCore::Converter<${this.idlType}>::convertInto(*globalObject, ${value}, ${ctx}, ${target});`,
      check,
    );
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
    return `${alternative.type.cppAssign(`${target}.${alternative.name}`, value)}\n${tag}`;
  }
  toRust(value: unknown, scope: RustScope): string {
    const { type, variant } = this.alternativeOfAbsent(value);
    return `${this.path(scope, this.name)}::${variant}${type instanceof UnitType ? "" : `(${type.toRust(value, scope)})`}`;
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

export interface SignatureOptions {
  args?: Record<string, Type>;
  returns?: Type;
  capability?: Capability;
  /** The body returns `Result<T, E>` for any `E: bindgen::IntoError`. */
  throws?: boolean;
  /** Path of the Rust function. Defaults to the module's path plus the export's name in snake_case. */
  rustPath?: string;
  /** The JS function's `length`. Defaults to the number of required arguments. */
  length?: number;
  /** Node's `ERR_INVALID_ARG_TYPE` for a wrong type: a list is its `(name, expected, actual)`, a string the whole message. */
  expected?: Record<string, readonly string[] | string>;
}

export class Signature {
  readonly args: readonly { name: string; type: Type; expected?: readonly string[] | string }[];
  readonly returns: Type;
  readonly capability: Capability;
  readonly throws: boolean;
  readonly rustPath: string | undefined;
  readonly length: number | undefined;
  /** `hasThisValue`: the body is also handed its own JS object. */
  constructor(options: SignatureOptions, hasThisValue = false) {
    this.length = options.length;
    const { args = {}, expected = {} } = options;
    this.args = Object.entries(args).map(([name, type]) => ({ name, type, expected: expected[name] }));
    for (const [name, types] of Object.entries(expected)) {
      assert(name in args, `expected: ${name} is not an argument`);
      assert(types.length > 0, `expected: ${name} expects nothing`);
    }
    this.returns = options.returns ?? new UnitType("undefined");
    this.capability = options.capability ?? "none";
    this.throws = options.throws ?? false;
    this.rustPath = options.rustPath;
    assertDistinct(
      this.args.map(arg => snakeCase(arg.name)),
      "arguments",
    );
    assert(
      this.length === undefined || (Number.isInteger(this.length) && this.length >= 0),
      `length: ${this.length} is not a count`,
    );
    for (const { name, type } of this.args) {
      refuseResultType(name, type);
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
    assert(!(this.returns instanceof DefaultType), "a result has no default");
    assert(
      !this.returns.holdsJSValue || this.capability !== "none" || hasThisValue,
      'returning a JS value takes capability: "heap" or "js"',
    );
  }
  /** The arguments up to the last that is not optional: what a caller writes at least. */
  get requiredCount(): number {
    return this.args.findLastIndex(arg => !arg.type.isOptional) + 1;
  }
}

/** The first `ResultType` that `type` is or is made of. */
function resultTypeIn(type: Type): ResultType | undefined {
  if (type instanceof ResultType) return type;
  for (const dependency of type.dependencies) {
    const found = resultTypeIn(dependency);
    if (found) return found;
  }
}

function refuseResultType(name: string, type: Type): void {
  const result = resultTypeIn(type);
  assert(!result, `${name}: ${result?.refusal}`);
}

/** Call a signature, or look at the kind of one more argument. */
export type OverloadDispatch = Signature | { argument: number; byKind: Map<ValueKind | "other", OverloadDispatch> };

export class FunctionDefinition {
  readonly signatures: readonly Signature[];
  readonly dispatch: OverloadDispatch;
  name = "";
  origin: Origin | null = null;
  constructor(signatures: readonly (SignatureOptions | Signature)[]) {
    assert(signatures.length > 0, "b.overloads needs at least one signature");
    this.signatures = signatures.map(options => (options instanceof Signature ? options : new Signature(options)));
    assert(this.signatures.filter(signature => signature.length !== undefined).length <= 1, "length is given once");
    const nodes = new Map<string, OverloadDispatch>();
    this.dispatch = this.dispatchOn(this.signatures, 0, nodes);
    const chosen = new Set(nodes.values());
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
          candidates.filter((signature, i) => !types[i] || test(types[i]));
        const ofKind = keep(type => takes(type, kind));
        const takers = kind === "undefined" ? keep(type => type.takesUndefined) : ofKind;
        const kept = [takers, ofKind, candidates].find(list => list.length > 0)!;
        return this.dispatchOn(kept, argument + 1, nodes);
      };
      const kinds = new Set(["undefined" as const, ...distinguishingKinds(types.filter(type => type !== undefined))]);
      const byKind = new Map([...kinds].map(kind => [kind, next(kind)]));
      dispatch = new Set(byKind.values()).size === 1 ? byKind.get("other")! : { argument, byKind };
    }
    nodes.set(key, dispatch);
    return dispatch;
  }
  get length(): number {
    const given = this.signatures.find(signature => signature.length !== undefined);
    return given?.length ?? Math.min(...this.signatures.map(signature => signature.requiredCount));
  }
}

// ───────────────────────────── classes ─────────────────────────────

/** A native function. */
export interface FunctionField extends Omit<SignatureOptions, "rustPath"> {
  /** `&mut self` instead of `&self`. Not with `capability: "js"`, which gets the wrapper. */
  mutates?: boolean;
  /** Also pass the wrapper, `this_value: JsWrapper<'a, Self>`. A method whose receiver is the wrapper already has it. */
  passThis?: boolean;
  /** When `this` is not an instance: `"throw"` (the default) throws `ERR_INVALID_THIS`, `"undefined"` returns `undefined`. */
  invalidThis?: "throw" | "undefined";
  /** Key the function by this private builtin name (`$name` in src/js) instead of a string. */
  privateSymbol?: string;
  /** The Rust function. Defaults to the property's name in snake_case. */
  rustName?: string;
  /** Overrides the function's `name`. Only for an `@@` key, where it defaults to `[Symbol.x]`. */
  name?: string;
}

export interface GetterField {
  getter: Type;
  /** Also generate a setter, which takes `&mut self` (the wrapper with `capability: "js"`, `&self` in a `refCounted` class). Its `capability` is the getter's unless it names its own. */
  setter?: true | { capability: Capability };
  /** Returns an internal field, and computes it while that is empty. `true` declares one of the getter's name, a string names one declared elsewhere. */
  cache?: true | string;
  capability?: Capability;
  throws?: boolean;
  /** As a function's. */
  passThis?: boolean;
  /** The getter is `get_` and this name, the setter `set_` and this name. Defaults to the property's name in snake_case. */
  rustName?: string;
}

/** An accessor that reads an internal field in C++, without calling Rust. With `setter: true` it also stores any value assigned to it. */
export interface InternalFieldField {
  internalField: string;
  setter?: true;
}

/** A function written in JavaScript: the export of this name in `src/js/builtins/<class name>.ts`. */
export interface BuiltinField {
  builtin: true;
  length: number;
}

/** Several functions are the overloads of one. `rustName` tells their Rust functions apart. A key that starts with `@@` is a well-known symbol: `@@iterator` is `Symbol.iterator`. */
export type Field = FunctionField | readonly FunctionField[] | GetterField | InternalFieldField | BuiltinField;
export type StaticField =
  | Omit<FunctionField, "mutates" | "passThis" | "invalidThis" | "privateSymbol" | "name">
  | Omit<GetterField, "setter" | "cache" | "passThis">;

export interface ClassOptions {
  /** Path of the Rust struct. The members are its own methods. */
  rustPath: string;
  /** The struct is intrusively refcounted and the JS object holds one ref, so it can outlive the object. Every member takes `&self`. */
  refCounted?: boolean;
  /** With `refCounted`: call `fn finalize(&self)` when the object is collected, before its ref is dropped. */
  finalize?: boolean;
  /** Absent: JavaScript cannot construct one, and there is no constructor object. `"illegal"`: there is one, and `new` on it throws `Illegal constructor`. */
  construct?: Omit<SignatureOptions, "rustPath" | "returns"> | "illegal";
  /** Properties of the prototype. */
  proto?: Record<string, Field>;
  /** Properties of the constructor. */
  static?: Record<string, StaticField>;
  /** JS values the object holds, empty at first. The GC visits them; `js_Name` gets `x_get_cached` / `x_set_cached` / `x_take_cached` for each. */
  internalFields?: readonly string[];
  /** `false`: native properties are non-configurable. */
  configurable?: boolean;
}

/** The property's name without a leading `_` or `@@`, for use in generated identifiers. */
export const memberIdentifier = (name: string) => name.replace(/^(_+|@@)/, "");
/** `iterator` for the key `@@iterator`, `undefined` for a key that is not a well-known symbol. */
export const wellKnownSymbol = (name: string) => (name.startsWith("@@") ? name.slice(2) : undefined);

type Receiver = "ref" | "mut" | "wrapper" | "static";
const memberReceiver = (isStatic: boolean, refCounted: boolean, capability: Capability, mutates: boolean): Receiver =>
  isStatic ? "static" : refCounted ? "ref" : capability === "js" ? "wrapper" : mutates ? "mut" : "ref";

function memberRustName(name: string): string {
  assert(/^[a-z_][a-z0-9_]*$/.test(name), `${name}: rustName is written in snake_case`);
  return rustIdent(name);
}

export class Method extends Signature {
  readonly name: string;
  readonly rustName: string;
  readonly hasDefaultRustName: boolean;
  readonly receiver: Receiver;
  readonly passThis: boolean;
  readonly invalidThis: "throw" | "undefined";
  readonly privateSymbol: string | undefined;
  readonly functionName: string | undefined;
  constructor(name: string, options: FunctionField, isStatic = false, refCounted = false) {
    super(options, !isStatic && (!!options.passThis || (!refCounted && options.capability === "js")));
    this.name = name;
    this.rustName = memberRustName(options.rustName ?? snakeCase(memberIdentifier(name)));
    this.hasDefaultRustName = options.rustName === undefined;
    assert(
      !(options.mutates && this.capability === "js"),
      `${name}: a method that can run JavaScript gets the wrapper, not &mut self`,
    );
    assert(!(options.mutates && refCounted), `${name}: a refCounted class has no mutates: every member takes &self`);
    this.receiver = memberReceiver(isStatic, refCounted, this.capability, !!options.mutates);
    this.passThis = this.receiver !== "static" && this.receiver !== "wrapper" && !!options.passThis;
    this.invalidThis = options.invalidThis ?? "throw";
    this.privateSymbol = options.privateSymbol;
    assert(!(this.privateSymbol && wellKnownSymbol(name)), `${name}: an @@ key has no privateSymbol`);
    this.functionName = options.name;
    assert(this.functionName === undefined || wellKnownSymbol(name), `${name}: name is only for an @@ key`);
  }
}

export class Getter {
  readonly name: string;
  readonly type: Type;
  readonly capability: Capability;
  readonly throws: boolean;
  readonly hasSetter: boolean;
  readonly internalField: string | undefined;
  readonly declaresInternalField: boolean;
  readonly isStatic: boolean;
  readonly rustName: string;
  readonly setterRustName: string;
  readonly receiver: Receiver;
  readonly setterReceiver: Receiver;
  readonly passThis: boolean;
  readonly setterCapability: Capability;
  constructor(name: string, options: GetterField, isStatic = false, refCounted = false) {
    this.name = name;
    this.isStatic = isStatic;
    const rustName = options.rustName ?? snakeCase(memberIdentifier(name));
    this.rustName = memberRustName(`get_${rustName}`);
    this.setterRustName = `set_${rustName}`;
    this.type = options.getter;
    this.capability = options.capability ?? "none";
    this.setterCapability = typeof options.setter === "object" ? options.setter.capability : this.capability;
    this.receiver = memberReceiver(isStatic, refCounted, this.capability, false);
    this.setterReceiver = memberReceiver(isStatic, refCounted, this.setterCapability, true);
    this.passThis = !!options.passThis;
    assert(!(this.passThis && isStatic), `${name}: a static getter has no passThis`);
    this.throws = options.throws ?? false;
    this.hasSetter = !!options.setter;
    assert(!(options.cache && options.setter), `${name}: a cached getter has no setter`);
    if (this.hasSetter) refuseResultType(name, this.type);
    assert(!(isStatic && (options.cache || options.setter)), `${name}: a static getter has no cache and no setter`);
    assert(
      !this.type.holdsJSValue || this.capability !== "none" || this.passThis,
      `${name}: returning a JS value takes capability: "heap" or "js"`,
    );
    this.internalField = options.cache === true ? name : options.cache;
    this.declaresInternalField = options.cache === true;
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

export type ClassMember = FunctionDefinition | Getter | InternalFieldAccessor | Builtin;

/** Stands for the class being declared, in its own signatures. */
class SelfType extends Type {
  readonly idlType = "";
  readonly tsType = "this";
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

/** As an argument or a result: the wrapper, `JsWrapper<'a, T>`. A `refCounted` class as an argument is `&'a T`. */
export class ClassType extends NamedType {
  readonly rustPath: string;
  readonly refCounted: boolean;
  readonly finalize: boolean;
  readonly construct: Signature | null;
  readonly illegalConstructor: boolean;
  /** The native functions of the prototype. The signatures of each are `Method`s. */
  readonly functions: readonly FunctionDefinition[];
  readonly getters: readonly Getter[];
  readonly internalFieldAccessors: readonly InternalFieldAccessor[];
  readonly staticFunctions: readonly FunctionDefinition[];
  readonly staticGetters: readonly Getter[];
  readonly builtins: readonly Builtin[];
  /** The properties of the prototype and of the constructor, as written. */
  readonly protoMembers: readonly ClassMember[];
  readonly staticMembers: readonly ClassMember[];
  /** The schema's, then those of `cache: true` getters. */
  readonly internalFields: readonly string[];
  readonly configurable: boolean;
  /** Index in `AdditionsToGlobalObject::m_classes`. Set by the generator. */
  classIndex = -1;
  constructor(options: ClassOptions) {
    super();
    this.rustPath = options.rustPath;
    this.refCounted = options.refCounted ?? false;
    this.finalize = options.finalize ?? false;
    assert(this.refCounted || !this.finalize, "finalize is only for a refCounted class: otherwise implement Drop");
    const own = (type: Type): Type => {
      if (type === selfType) return this;
      return type instanceof OptionalType && type.inner === selfType ? new OptionalType(this, type.modifier) : type;
    };
    const resolve = <T extends SignatureOptions>(signature: T): T => ({
      ...signature,
      args: Object.fromEntries(Object.entries(signature.args ?? {}).map(([name, type]) => [name, own(type)])),
      ...(signature.returns ? { returns: own(signature.returns) } : {}),
    });
    this.illegalConstructor = options.construct === "illegal";
    this.construct = options.construct
      ? new Signature(options.construct === "illegal" ? {} : resolve(options.construct))
      : null;
    const members = (fields: Record<string, Field>, isStatic: boolean) =>
      Object.entries(fields).map(([name, field]): ClassMember => {
        assert(
          !wellKnownSymbol(name) || !("builtin" in field || "internalField" in field || "getter" in field),
          `${name}: only a function has an @@ key`,
        );
        if ("builtin" in field) {
          assert(!isStatic, `${name}: a builtin is a property of the prototype`);
          return new Builtin(name, field.length);
        }
        if ("internalField" in field) {
          assert(!isStatic, `${name}: an internalField accessor is a property of the prototype`);
          return new InternalFieldAccessor(name, field);
        }
        if ("getter" in field) {
          assert(!("args" in field || "returns" in field), `${name}: a getter has no args or returns`);
          return new Getter(name, { ...field, getter: own(field.getter) }, isStatic, this.refCounted);
        }
        const overloads: readonly FunctionField[] = Array.isArray(field) ? field : [field];
        for (const key of ["privateSymbol", "invalidThis", "name"] as const)
          assert(
            overloads.every(overload => overload[key] === overloads[0]?.[key]),
            `${name}: its overloads have one ${key}`,
          );
        assert(!(isStatic && wellKnownSymbol(name)), `${name}: an @@ key is a property of the prototype`);
        const fn = new FunctionDefinition(
          overloads.map(overload => new Method(name, resolve(overload), isStatic, this.refCounted)),
        );
        fn.name = name;
        return fn;
      });
    this.protoMembers = members(options.proto ?? {}, false);
    this.staticMembers = members(options.static ?? {}, true);
    this.functions = this.protoMembers.filter(member => member instanceof FunctionDefinition);
    this.getters = this.protoMembers.filter(member => member instanceof Getter);
    this.internalFieldAccessors = this.protoMembers.filter(member => member instanceof InternalFieldAccessor);
    this.builtins = this.protoMembers.filter(member => member instanceof Builtin);
    this.staticFunctions = this.staticMembers.filter(member => member instanceof FunctionDefinition);
    this.staticGetters = this.staticMembers.filter(member => member instanceof Getter);
    const { getters } = this;
    assert(this.construct || this.staticMembers.length === 0, "static members need a constructor object");
    this.internalFields = [
      ...(options.internalFields ?? []),
      ...getters.filter(getter => getter.declaresInternalField).map(getter => getter.name),
    ];
    for (const { name, internalField } of [...getters, ...this.internalFieldAccessors])
      assert(
        internalField === undefined || this.internalFields.includes(internalField),
        `${name}: there is no internal field ${internalField}`,
      );
    for (const field of this.internalFields)
      assert(/^[a-z][A-Za-z0-9]*$/.test(field), `${field}: an internal field is named in camelCase`);
    // A `rustName` may be another member's function.
    assertDistinct(
      [
        "constructor",
        ...this.methods.filter(method => method.hasDefaultRustName).map(method => method.rustName),
        ...[...getters, ...this.staticGetters].flatMap(getter => [
          getter.rustName,
          ...(getter.hasSetter ? [getter.setterRustName] : []),
        ]),
      ],
      "members' Rust functions",
    );
    assertDistinct(this.internalFields.map(snakeCase), "internal fields");
    this.configurable = options.configurable ?? true;
    for (const method of this.methods) {
      assert(
        method.receiver !== "mut" || !method.args.some(arg => arg.type === this),
        `${method.name}: &mut self and an argument of the same class may be the same object`,
      );
    }
  }
  /** Every signature of the prototype's and the constructor's functions. */
  get methods(): readonly Method[] {
    return [...this.functions, ...this.staticFunctions].flatMap(fn => fn.signatures as readonly Method[]);
  }
  get cpp(): string {
    return `Bun::Bindgen::Generated::JS${this.name}`;
  }
  get idlType(): string {
    return this.refCounted
      ? `Bun::Bindgen::IDLWrappedInterface<${this.cpp}, std::to_array("${this.name}")>`
      : `Bun::Bindgen::IDLRawInterface<${this.cpp}>`;
  }
  get valueKinds(): ValueKinds {
    return [this];
  }
  get holdsJSValue(): boolean {
    return true;
  }
  get borrowsCell(): boolean {
    return this.refCounted;
  }
  get nullRepresentation() {
    return "pointer" as const;
  }
  /** Signatures are not dependencies: a class may mention itself. */
  get signatureTypes(): Type[] {
    return [
      ...(this.construct ? this.construct.args.map(arg => arg.type) : []),
      ...this.methods.flatMap(method => [...method.args.map(arg => arg.type), method.returns]),
      ...[...this.getters, ...this.staticGetters].map(getter => getter.type),
    ];
  }
  layout(): Layout {
    return { size: 8, align: 8 };
  }
  rustExternType(): string {
    return "*mut core::ffi::c_void";
  }
  rustType(): string {
    return this.refCounted ? `&'a ${this.rustPath}` : `bindgen::JsWrapper<'a, ${this.rustPath}>`;
  }
  rustFromExtern(expr: string): string {
    return this.refCounted
      ? `bindgen::class_ref_from_extern::<${this.rustPath}>(${expr}, heap)`
      : `bindgen::JsWrapper::<${this.rustPath}>::from_extern(core::ptr::NonNull::new_unchecked(${expr}), heap)`;
  }
  rustToJS(value: string): string {
    return `bindgen::to_js::any(heap, ${value})`;
  }
}

export interface NamespaceOptions {
  /** The object is itself a function, named as the namespace is, that does what this one of its functions does. */
  call?: string;
}

/** A plain object whose properties are native functions, as WebIDL's `namespace`. With `call`, a function that has them. */
export class NamespaceDefinition {
  readonly functions: readonly FunctionDefinition[];
  readonly call: FunctionDefinition | undefined;
  name = "";
  constructor(functions: Record<string, SignatureOptions>, options: NamespaceOptions = {}) {
    this.functions = Object.entries(functions).map(([name, options]) => {
      assert(/^[A-Za-z_$][\w$]*$/.test(name), `${name}: a function is named by an identifier`);
      assert(!(options instanceof FunctionDefinition), `${name}: write what b.fn takes, without b.fn`);
      const fn = new FunctionDefinition([options]);
      fn.name = name;
      return fn;
    });
    assert(this.functions.length > 0, "a namespace with no functions");
    this.call = this.functions.find(fn => fn.name === options.call);
    assert(options.call === undefined || this.call, `call: ${options.call} is not one of its functions`);
  }
}

export class ModuleDefinition {
  /** Rust path the file's functions live under, e.g. `crate::node::node_os`. */
  readonly rustPath: string;
  constructor(options: { rustPath: string }) {
    this.rustPath = options.rustPath;
  }
}
