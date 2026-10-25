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
  | "typedArray"
  | "dataView"
  | "callable"
  | JSClass;

/** The instances of a C++ `JSCell` class. */
export interface JSClass {
  readonly cpp: string;
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
  typedArray: { ofCell: "JSC::isTypedArrayType(cell->type())" },
  dataView: { ofCell: "cell->inherits<JSC::JSDataView>()" },
  callable: { ofCell: "cell->isCallable()" },
};

/** The classes of JSC whose instances are kinds. */
const kindsOfClass: Record<string, readonly ValueKind[]> = {
  "JSC::JSBigInt": ["bigint"],
  "JSC::JSString": ["string"],
  "JSC::StringObject": ["stringObject"],
  "JSC::JSArray": ["array"],
  "JSC::JSArrayBuffer": ["arrayBuffer"],
  "JSC::JSArrayBufferView": ["typedArray", "dataView"],
  "JSC::JSDataView": ["dataView"],
};

const classes = new Map<string, JSClass>();
/** One object for each class: kinds are compared by identity. */
function kindsOfCell(cpp: string): readonly ValueKind[] {
  if (!classes.has(cpp)) classes.set(cpp, { cpp });
  return kindsOfClass[cpp] ?? [classes.get(cpp)!];
}

/** The kind that a class of JSC is only a part of. C++ tests the kind first, so an alternative that takes it hides the class. */
function kindAroundClass({ cpp }: JSClass): ValueKind | undefined {
  if (/^JSC::JS(Big)?(Ui|I)nt\d+(Clamped)?Array$|^JSC::JSFloat\d+Array$/.test(cpp)) return "typedArray";
  if (/^JSC::(JS|Internal)Function$/.test(cpp)) return "callable";
}

/** `tests` of one outcome, with one test for the two kinds of view. */
export function mergeViewTests(tests: readonly string[]): string[] {
  const views = [kindTests.typedArray.ofCell!, kindTests.dataView.ofCell!];
  if (!views.every(test => tests.includes(test))) return [...tests];
  return tests.flatMap(test =>
    test === views[0] ? "cell->inherits<JSC::JSArrayBufferView>()" : test === views[1] ? [] : test,
  );
}

const primitiveKinds: readonly (ValueKind | "other")[] = ["undefined", "null", "boolean", "number", "bigint", "string"];
/** What a type that takes every object `refuses`. */
const nonObjects = "what is not an object";
export const refusesNonObjects = (type: Type) => type.refuses === nonObjects;

const takes = (type: Type, kind: ValueKind | "other") =>
  type.valueKinds === "any" || (kind !== "other" && type.valueKinds.includes(kind));

const distinguishingKinds = (types: readonly Type[]): (ValueKind | "other")[] => [
  ...types
    .flatMap(type => (type.valueKinds === "any" ? [] : type.valueKinds))
    .filter((kind, index, kinds) => kinds.indexOf(kind) === index),
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
  /** Every value of a kind it does not take, or that it refuses, means absent. */
  get otherAsNull(): OptionalType {
    return new OptionalType(this, "otherAsNull");
  }
  /** Absent only if the call has no such argument: `undefined` is converted like any other value. Only for an argument. */
  get ifPassed(): OptionalType {
    return new OptionalType(this, "ifPassed");
  }
  /** Converted when the body says so: a `Deferred<'a, T>`. For an argument or an alternative of a union, and written last. */
  get deferred(): DeferredType {
    return new DeferredType(this);
  }
  /**
   * Also the value itself: `(T, JsLocal<'a>)`. Written last and only for an argument, except on an instance that Rust
   * takes as `&T`: there the value is the cell that keeps it alive, and the two go wherever a type goes.
   */
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
    const ofCell = mergeViewTests(
      kinds.flatMap(kind =>
        typeof kind === "object" ? `cell->inherits<${kind.cpp}>()` : (kindTests[kind].ofCell ?? []),
      ),
    ).map(test => test.replace("cell", `${value}.asCell()`));
    return [...ofValue, ...(ofCell.length > 0 ? [`(${value}.isCell() && (${ofCell.join(" || ")}))`] : [])].join(" || ");
  }
  /** Written `.optional`, `.nullable`, `.falsyAsNull`, `.emptyStringAsNull`, `.otherAsNull`, `.ifPassed` or `.default()`. `length` leaves out a trailing run of these. */
  get isOptional(): boolean {
    return false;
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
    return this.borrowedByBody ? `&${name}` : name;
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
  /** What `undefined` converts to, as a Rust expression of `rustType`, where that is a constant. Rust then needs no C++ for it. */
  rustOfUndefined(scope: RustScope): string | null {
    return null;
  }
  /** A C++ expression that converts `value`, for a type whose conversion cannot throw. `ctx` is a conversion context. */
  cppConvert(value: string, ctx: string): string {
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
  /** C++ statements that convert `value` into `target`, just default-constructed, and return `failure` if that throws. */
  cppConvertInto(target: string, value: string, ctx: string, name: string, failure: string): string {
    if (!this.conversionThrows) return `${target} = ${this.cppConvert(value, ctx)};`;
    return cppReturnIfFailed(
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

export class PrimitiveType extends Type {
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
  get tryConvertThrows(): boolean {
    return false;
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
  get insteadOfOtherAsNull(): string | null {
    return "b.f64.otherAsNull takes every number";
  }
  /** Also a BigInt that is in range, for an argument whose type is `number | bigint`. */
  get allowBigInt(): IntegerType {
    if (this.#conversion === `WebCore::${this.info.webidl}`) return new IntegerType(this.info, "Strict", true).wrap;
    assert(
      this.#conversion === "Strict" || this.#conversion === "Loose",
      ".allowBigInt is for the strict, the .loose and the .wrap conversion; the others refuse a BigInt",
    );
    return new IntegerType(this.info, this.#conversion, true);
  }
  /** `ToNumber` first, or `ToNumeric` with `.allowBigInt`, then as strict as the default. */
  get loose(): IntegerType {
    return new IntegerType(this.info, "Loose", this.#allowBigInt);
  }
  /** WebIDL conversion: `ToNumber`, then wrap modulo the width. With `.allowBigInt`, a BigInt wraps too. */
  get wrap(): IntegerType {
    const idl = `WebCore::${this.info.webidl}` as const;
    return new IntegerType(this.info, this.#allowBigInt ? `Bun::Bindgen::IDLWrapOrBigInt<${idl}>` : idl);
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
  /** As strict, over `[min, max]`, except that a fraction is `ERR_INVALID_ARG_TYPE` too. The value is reported as a property. */
  validateIntegerRange(min = Number(this.info.min), max = Number(this.info.max)): RangeType {
    this.#refusesBigInt(".validateIntegerRange()");
    return new RangeType(this.info, min, max, "validateIntegerRange");
  }
  /** `BigInt.asIntN(64, value)`: takes a BigInt, and every one. */
  get asIntN(): BigIntAsIntNType {
    assert(this.info.rust === "i64" && this.#conversion === "Strict" && !this.#allowBigInt, ".asIntN follows b.i64");
    return new BigIntAsIntNType(this.info);
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

export class BigIntAsIntNType extends IntegerType {
  constructor(info: IntegerInfo) {
    super(info, "Bun::Bindgen::IDLBigIntAsInt64", false, "bigint");
  }
  get valueKinds(): ValueKinds {
    return ["bigint"];
  }
  get insteadOfOtherAsNull(): null {
    return null;
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
  readonly modifier: "enforceRange" | "validateInteger" | "validateIntegerRange";
  readonly #range: readonly [number, number];
  readonly #nan: number | undefined;
  readonly #reportedAs: string | undefined;
  constructor(
    info: IntegerInfo,
    min: number,
    max: number,
    modifier: RangeType["modifier"],
    nan?: number,
    reportedAs?: string,
  ) {
    assert(
      Number.isSafeInteger(min) && Number.isSafeInteger(max) && min <= max,
      `[${min}, ${max}] is not a range of integers`,
    );
    assert(min >= Number(info.min) && max <= Number(info.max), `[${min}, ${max}] does not fit ${info.rust}`);
    const tag = {
      enforceRange: "IDLEnforceRange",
      validateInteger: "IDLValidateInteger",
      validateIntegerRange: "IDLValidateIntegerRange",
    }[modifier];
    super(
      info,
      `Bun::Bindgen::${tag}<${[info.cpp, min, max, ...(nan === undefined ? [] : [nan])].join(", ")}>`,
      false,
      modifier === "enforceRange" ? "any" : "number",
    );
    this.modifier = modifier;
    this.#range = [min, max];
    this.#nan = nan;
    this.#reportedAs = reportedAs;
  }
  /** One that validates does not coerce: what is not a number can go to another alternative. */
  get valueKinds(): ValueKinds {
    return this.modifier === "enforceRange" ? "any" : ["number"];
  }
  protected get range() {
    return this.#range;
  }
  /** What NaN converts to. Without it NaN is refused, as a fraction is. */
  nanAs(value: number): RangeType {
    assert(this.modifier === "validateIntegerRange", ".nanAs() follows .validateIntegerRange()");
    assert(
      Number.isSafeInteger(value) && value >= this.info.min && value <= this.info.max,
      `${value} does not fit ${this.info.rust}`,
    );
    return new RangeType(this.info, ...this.#range, this.modifier, value, this.#reportedAs);
  }
  /** What its errors call the value, if not what it is the type of: the `fd` of a path or a file descriptor. */
  reportedAs(name: string): RangeType {
    assert(this.modifier !== "enforceRange", ".enforceRange() does not name the value");
    return new RangeType(this.info, ...this.#range, this.modifier, this.#nan, name);
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
  /** Its converter takes no context. Those that validate take the name. */
  cppConvertInto(target: string, value: string, ctx: string, name: string, failure: string): string {
    // An alternative of a union is not given a name.
    const source = this.#reportedAs || name ? asciiLiteral(this.#reportedAs ?? name) : `${ctx}.source()`;
    const reported = this.modifier === "enforceRange" ? "" : `, ${source}`;
    return cppReturnIfFailed(
      `WebCore::Converter<${this.idlType}>::convertInto(*globalObject, ${value}${reported}, ${target})`,
      failure,
    );
  }
}

const integer = (rust: string, cpp: string, size: number, webidl: string, min: number | bigint, max: number | bigint) =>
  new IntegerType({ rust, cpp, size, webidl, min, max });

export const integers = {
  u8: integer("u8", "uint8_t", 1, "IDLOctet", 0, 255),
  u16: integer("u16", "uint16_t", 2, "IDLUnsignedShort", 0, 65535),
  i32: integer("i32", "int32_t", 4, "IDLLong", -2147483648, 2147483647),
  u32: integer("u32", "uint32_t", 4, "IDLUnsignedLong", 0, 4294967295),
  i64: integer("i64", "int64_t", 8, "IDLLongLong", Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
  u64: integer("u64", "uint64_t", 8, "IDLUnsignedLongLong", 0, Number.MAX_SAFE_INTEGER),
  usize: integer("usize", "uint64_t", 8, "IDLUnsignedLongLong", 0, Number.MAX_SAFE_INTEGER),
};

export class DoubleType extends PrimitiveType {
  constructor(idlType = "Bun::Bindgen::IDLStrictDouble", valueKinds: ValueKinds = ["number"]) {
    super(
      idlType,
      valueKinds === "any" ? "any" : valueKinds.includes(dateInstance) ? "number | Date" : "number",
      "f64",
      8,
      valueKinds,
    );
  }
  get tryConvertThrows(): boolean {
    return false;
  }
  /** A `Date` too, as its time value, which is NaN for an invalid one. */
  get allowDate(): DoubleType {
    assert(this.idlType === "Bun::Bindgen::IDLStrictDouble", ".allowDate follows b.f64");
    return new DoubleType("Bun::Bindgen::IDLStrictDoubleOrDate", ["number", dateInstance]);
  }
  /** As a result: a `Date` with that time value. */
  get asDate(): DateResultType {
    assert(this.idlType === "Bun::Bindgen::IDLStrictDouble", ".asDate follows b.f64");
    return new DateResultType();
  }
  /** `ToNumber`: WebIDL's `unrestricted double`. */
  get loose(): LooseDoubleType {
    assert(this.idlType === "Bun::Bindgen::IDLStrictDouble", ".loose follows b.f64");
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
  readonly unit: "null" | "undefined" | "ignored";
  constructor(unit: UnitType["unit"]) {
    super();
    this.unit = unit;
    this.idlType = {
      null: "Bun::Bindgen::IDLStrictNull",
      undefined: "Bun::Bindgen::IDLStrictUndefined",
      ignored: "Bun::Bindgen::IDLIgnored",
    }[unit];
  }
  get tsType(): string {
    return { null: "null | undefined", undefined: "undefined", ignored: "any" }[this.unit];
  }
  get valueKinds(): ValueKinds {
    return ({ null: ["undefined", "null"], undefined: ["undefined"], ignored: "any" } as const)[this.unit];
  }
  get takesUndefined(): boolean {
    return true;
  }
  cppConvertInto(): string {
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
    assert(this.unit !== "ignored", "b.ignored is only an alternative of a union");
    return `bindgen::to_js::${this.unit}(heap, ${value})`;
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
  /** As an argument: `bun_core::String` by value, for a body that keeps it, instead of `&bun_core::String`. */
  get owned(): OwnedStringType {
    return new OwnedStringType(this.idlType, this.valueKinds);
  }
  /** `bun_core::StringView<'a>` for the duration of the call, for a body that only reads the characters. It takes no reference, and a slice of another string is not copied out of it. */
  get view(): StringViewType {
    assert(this.valueKinds !== "any", ".view follows b.string or b.string.allowStringObject");
    return new StringViewType(this.valueKinds);
  }
  /** As a result: the JS string, which the body made. */
  get local(): LocalStringResultType {
    assert(this.idlType === "Bun::Bindgen::IDLStrictString", ".local follows b.string");
    return new LocalStringResultType();
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
  cppConvertInto(target: string, value: string, ctx: string, name: string, failure: string): string {
    return cppReturnIfFailed(
      `WebCore::Converter<${this.idlType}>::convertInto(*globalObject, ${value}, ${ctx}, ${target}, "a string"_s)`,
      failure,
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

const bufferSourceKinds: ValueKinds = ["arrayBuffer", "typedArray", "dataView"];
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
    return cppReturnIfFailed(
      `WebCore::Converter<${this.idlType}>::convertInto(*globalObject, ${value}, ${ctx}, ${target}, ${asciiLiteral(list)})`,
      failure,
    );
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

/** A JS value of some kind, as itself. */
export class LocalType extends Type {
  readonly idlType: string;
  readonly tsType: string;
  readonly #marker: string;
  readonly #valueKinds: ValueKinds;
  readonly #refuses: string | null;
  constructor(idlType: string, tsType: string, marker: string, valueKinds: ValueKinds, refuses: string | null) {
    super();
    this.idlType = idlType;
    this.tsType = tsType;
    this.#marker = marker;
    this.#valueKinds = valueKinds;
    this.#refuses = refuses;
  }
  get valueKinds(): ValueKinds {
    return this.#valueKinds;
  }
  get refuses(): string | null {
    return this.#refuses;
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
    return `bindgen::JsLocal<'a, ${this.#marker}>`;
  }
  rustFromExtern(expr: string): string {
    return `bindgen::JsLocal::from_extern(${expr}, heap)`;
  }
  rustToJS(value: string): string {
    return `bindgen::to_js::any(heap, ${value})`;
  }
}
export const objectType = new LocalType("Bun::Bindgen::IDLRawObject", "object", "bun_jsc::JSObject", "any", nonObjects);
export const jsArrayType = new LocalType(
  "Bun::Bindgen::IDLRawArray",
  "readonly any[]",
  "bun_jsc::JSArray",
  ["array"],
  null,
);
export const stringLikeType = new LocalType(
  "Bun::Bindgen::IDLRawStringLike",
  "string | String",
  "bindgen::StringLike",
  ["string", "stringObject"],
  null,
);
/** A function, or a proxy of one, for the body to call or to store. */
export const callableType = new LocalType(
  "Bun::Bindgen::IDLRawCallable",
  "((...args: any[]) => any)",
  "bindgen::Callable",
  ["callable"],
  null,
);

export interface CellOptions {
  /** What marks the handle: a `JsLocal<'a, ..>` of it. Absent: only the type of an internal field that C++ uses. */
  rustPath?: string;
  /** What an error calls it. Defaults to the name of the class without `JS`. */
  reportedAs?: string;
  tsType?: string;
}

/** An instance of a `JSCell` subclass, as itself. */
export class CellType extends LocalType {
  readonly cpp: string;
  readonly header: string;
  readonly #hasRustPath: boolean;
  constructor(cpp: string, header: string, options: CellOptions = {}) {
    assert(/^([A-Za-z_]\w*::)+[A-Z]\w*$/.test(cpp), `b.cell: ${cpp} needs its namespace`);
    const reportedAs = options.reportedAs ?? cpp.slice(cpp.lastIndexOf("::") + 2).replace(/^JS/, "");
    super(
      `Bun::Bindgen::IDLRawCell<${cpp}, std::to_array("${reportedAs}")>`,
      options.tsType ?? "object",
      options.rustPath ?? "",
      kindsOfCell(cpp),
      null,
    );
    this.cpp = cpp;
    this.header = header;
    this.#hasRustPath = options.rustPath !== undefined;
  }
  getHeaders(out: Set<string>): void {
    out.add(this.header);
  }
  rustType(): string {
    assert(this.#hasRustPath, `b.cell: ${this.cpp} needs a rustPath to be more than an internal field of C++`);
    return super.rustType();
  }
}

export class OpaqueType extends Type {
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
    assert(value === undefined, "b.opaque cannot have a default");
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

/** A conversion that Rust calls, and what an error calls the value. */
export class Conversion {
  readonly type: Type;
  readonly name: string;
  readonly expected: readonly string[] | string | undefined;
  /** Of the C++ function. Conversions of a file whose C++ source is the same share one. Set by the generator. */
  symbol?: string;
  /** Of the Rust function that calls it, in the file's module. Set by the generator. */
  rustName?: string;
  /** Hand-written Rust calls it: `b.conversion`. */
  exported = false;
  /** It is given the object, and reads the value from this member of it. */
  member?: { of: DeferredDictionaryType; index: number };
  constructor(type: Type, name: string, expected: readonly string[] | string | undefined) {
    assert(!type.borrowsFrame, `${name}: it is converted in another frame than the one it would borrow: write .owned`);
    assert(!type.borrowsHeap, `${name}: b.bytes is only for an argument; b.bufferSource is the handle`);
    this.type = type;
    this.name = name;
    this.expected = expected;
  }
}

/** Passed on as it is, with the conversion for the body to call. */
export abstract class ConvertedByBodyType extends Type {
  readonly inner: Type;
  /** Absent until it is the type of an argument or of an alternative, which names it. */
  readonly conversion: Conversion | null;
  constructor(inner: Type, conversion: Conversion | null) {
    super();
    refuseOutsideArgument(inner);
    this.inner = inner;
    this.conversion = conversion;
  }
  /** The same as the type of the argument `name`. */
  abstract ofArgument(name: string, expected: readonly string[] | string | undefined): Type;
  get holdsJSValue(): boolean {
    return true;
  }
  get conversionThrows(): boolean {
    return false;
  }
  get rustIsCopy(): boolean {
    return true;
  }
  get dependencies(): readonly Type[] {
    return [this.inner];
  }
  protected get rustConversion(): string {
    assert(this.conversion?.rustName, `${this.tsType}: only for an argument`);
    return this.conversion.rustName;
  }
}

export class DeferredType extends ConvertedByBodyType {
  readonly idlType = "Bun::Bindgen::IDLRawAny";
  constructor(inner: Type, conversion: Conversion | null = null) {
    super(inner, conversion);
    assert(!inner.passesValue, "b.bytes and .withValue are converted with the other arguments");
  }
  ofArgument(name: string, expected: readonly string[] | string | undefined): DeferredType {
    return new DeferredType(this.inner, new Conversion(this.inner, name, expected));
  }
  get tsType(): string {
    return this.inner.tsType;
  }
  get refusalOutsideArgument(): string {
    return ".deferred is only for an argument or an alternative of a union";
  }
  get returnsValueUnchanged(): boolean {
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
  layout(): Layout {
    return { size: 8, align: 8 };
  }
  rustExternType(): string {
    return "JSValue";
  }
  rustType(scope: RustScope): string {
    return `bindgen::Deferred<'a, ${this.inner.rustType(scope)}>`;
  }
  rustFromExtern(expr: string): string {
    return `bindgen::Deferred::from_extern(${expr}, heap, ${this.rustConversion})`;
  }
}

/** This argument and every one after it, borrowed from the call frame. */
export class RestType extends ConvertedByBodyType {
  readonly idlType = "Bun::Bindgen::IDLVariadicArguments";
  constructor(element: Type, conversion: Conversion | null = null) {
    super(element, conversion);
    assert(!element.isOptional || !isIfPassed(element), "an argument of the rest was passed");
  }
  ofArgument(name: string, expected: readonly string[] | string | undefined): RestType {
    if (this.inner instanceof OpaqueType) return this;
    return new RestType(this.inner, new Conversion(this.inner, name, expected));
  }
  get tsType(): string {
    return `(${this.inner.tsType})[]`;
  }
  get refusalOutsideArgument(): string {
    return "b.rest is only for the last argument";
  }
  get takesUndefined(): boolean {
    return true;
  }
  get isOptional(): boolean {
    return true;
  }
  layout(): Layout {
    return { size: 16, align: 8 };
  }
  rustExternType(): string {
    return "bindgen::extern_types::ExternVariadicArguments";
  }
  rustType(scope: RustScope): string {
    if (this.inner instanceof OpaqueType) return "&'a [bindgen::JsLocal<'a>]";
    return `bindgen::Rest<'a, ${this.inner.rustType(scope)}>`;
  }
  rustFromExtern(expr: string): string {
    if (this.inner instanceof OpaqueType) return `${expr}.get(heap)`;
    return `bindgen::Rest::from_extern(${expr}.get(heap), ${this.rustConversion})`;
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
  constructor(
    idlType: string,
    tsType: string,
    pointee: string,
    header: string | null,
    valueKinds: ValueKinds,
    refuses: string | null,
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

export interface WrappedOptions {
  /** The Rust type of what the C++ class wraps. */
  rustPath: string;
  /** What an error calls it. Defaults to the name of the class without `JS`. */
  reportedAs?: string;
  tsType?: string;
}

/** What an instance of a hand-written C++ wrapper class wraps: `thisObject->wrapped()`, as a `&'a T`. */
export class WrappedType extends Type {
  readonly cpp: string;
  readonly header: string;
  readonly options: WrappedOptions;
  /** Kinds are told apart by identity. */
  readonly #valueKinds: readonly ValueKind[];
  constructor(cpp: string, header: string, options: WrappedOptions) {
    super();
    assert(/^([A-Za-z_]\w*::)+[A-Z]\w*$/.test(cpp), `b.wrapped: ${cpp} needs its namespace`);
    this.#valueKinds = [{ cpp }];
    this.cpp = cpp;
    this.header = header;
    this.options = options;
  }
  get reportedAs(): string {
    return this.options.reportedAs ?? this.cpp.slice(this.cpp.lastIndexOf("::") + 2).replace(/^JS/, "");
  }
  /** A reference on it, which can be stored: an `ExternalShared<T>`. */
  get shared(): RefType {
    return new RefType(
      `Bun::Bindgen::IDLWrappedRef<${this.cpp}, std::to_array("${this.reportedAs}")>`,
      this.tsType,
      this.options.rustPath,
      this.header,
      this.valueKinds,
      null,
    );
  }
  get idlType(): string {
    return `Bun::Bindgen::IDLWrappedInterface<${this.cpp}, std::to_array("${this.reportedAs}")>`;
  }
  get tsType(): string {
    return this.options.tsType ?? `globalThis.${this.reportedAs}`;
  }
  get valueKinds(): ValueKinds {
    return this.#valueKinds;
  }
  get holdsJSValue(): boolean {
    return true;
  }
  get borrowsCell(): boolean {
    return true;
  }
  get tryConvertThrows(): boolean {
    return false;
  }
  get nullRepresentation() {
    return "pointer" as const;
  }
  getHeaders(out: Set<string>): void {
    out.add(this.header);
  }
  layout(): Layout {
    return { size: 8, align: 8 };
  }
  rustExternType(): string {
    return "*mut core::ffi::c_void";
  }
  rustType(): string {
    return `&'a ${this.options.rustPath}`;
  }
  rustFromExtern(expr: string): string {
    return `bindgen::class_ref_from_extern::<${this.options.rustPath}>(${expr}, heap)`;
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
    return `Option<core::ptr::NonNull<${this.pointee}>>`;
  }
  rustFromExtern(expr: string): string {
    return `core::ptr::NonNull::new(${super.rustFromExtern(expr)})`;
  }
}

// ───────────────────────────── combinators ─────────────────────────────

export class OptionalType extends Type {
  readonly inner: Type;
  readonly modifier: "optional" | "nullable" | "falsyAsNull" | "emptyStringAsNull" | "otherAsNull" | "ifPassed";
  constructor(inner: Type, modifier: OptionalType["modifier"]) {
    super();
    assert(!(inner instanceof OptionalType), "already optional");
    assert(!(inner instanceof DefaultType), "put .default() last");
    assert(!(inner instanceof WithValueType) || !inner.passesValue, "put .withValue last");
    assert(!(inner instanceof DeferredType), "put .deferred last");
    if (!inner.passesValue) refuseOutsideArgument(inner);
    if (modifier === "otherAsNull") {
      assert(!(inner instanceof UnionType), "a union takes the rest as its last alternative: other: b.ignored");
      assert(
        inner.valueKinds !== "any" || refusesNonObjects(inner),
        ".otherAsNull goes by the kind of a value, and this type does not: write it without .loose or nonObjectAsEmpty",
      );
      assert(
        !inner.insteadOfOtherAsNull,
        `.otherAsNull goes by the kind of a value, and this type throws for a value of a kind it takes: ${inner.insteadOfOtherAsNull}`,
      );
    }
    // `.ifPassed` does not claim `undefined`, so it goes on a type that takes it. So does a modifier on what takes every value.
    const ofUndefined = inner instanceof UnionType ? inner.alternativeOfUndefined?.type : inner;
    const takesEveryValue =
      ofUndefined instanceof OpaqueType || (ofUndefined instanceof UnitType && ofUndefined.unit === "ignored");
    if (modifier !== "ifPassed" && !takesEveryValue)
      assert(!inner.takesUndefined, `${inner.tsType} already takes undefined`);
    assert(
      !(inner instanceof BytesType) || inner.canBe(modifier),
      'b.bytes can be absent if it is held: "borrowed", and .nullable if it is string: "asIs"',
    );
    this.inner = inner;
    this.modifier = modifier;
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
  get takesUndefined(): boolean {
    return true;
  }
  get isOptional(): boolean {
    return true;
  }
  get refusalOutsideArgument(): string | null {
    return this.modifier === "ifPassed"
      ? ".ifPassed is only for an argument or a member with own: true and one name"
      : super.refusalOutsideArgument;
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
  rustOfUndefined(): string | null {
    return this.modifier === "ifPassed" ? null : "None";
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
    return this.inner instanceof DictionaryType ? `${name}.as_ref()` : name;
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

export const opaqueType = new OpaqueType();

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
  /** The value is the cell that keeps the instance alive, so the two together are for more than an argument. */
  get #isInstance(): boolean {
    return this.inner instanceof ClassType || this.inner instanceof WrappedType;
  }
  get idlType(): string {
    return this.#isInstance ? `Bun::Bindgen::IDLWithValue<${this.inner.idlType}>` : this.inner.idlType;
  }
  get tsType(): string {
    return this.inner.tsType;
  }
  get passesValue(): boolean {
    return !this.#isInstance;
  }
  get borrowsCell(): boolean {
    return !this.#isInstance && this.inner.borrowsCell;
  }
  get tryConvertThrows(): boolean {
    return this.inner.tryConvertThrows;
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
    return this.#isInstance ? super.cppConvert(value, ctx) : this.inner.cppConvert(value, ctx);
  }
  cppConvertInto(target: string, value: string, ctx: string, name: string, failure: string): string {
    return this.#isInstance
      ? super.cppConvertInto(target, value, ctx, name, failure)
      : this.inner.cppConvertInto(target, value, ctx, name, failure);
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
  get #valueType(): Type {
    return this.#isInstance ? objectType : opaqueType;
  }
  rustType(scope: RustScope): string {
    return `(${this.inner.rustType(scope)}, ${this.#valueType.rustType(scope)})`;
  }
  rustFromExtern(expr: string, scope: RustScope): string {
    return `(${this.inner.rustFromExtern(`${expr}.converted`, scope)}, ${this.#valueType.rustFromExtern(`${expr}.value`, scope)})`;
  }
}

export const isIfPassed = (type: Type): boolean =>
  type instanceof DeferredType ? isIfPassed(type.inner) : type instanceof OptionalType && type.modifier === "ifPassed";

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
  rustOfUndefined(scope: RustScope): string {
    return this.toRust(this.value, scope);
  }
  get valueKinds(): ValueKinds {
    if (this.inner.valueKinds === "any") return "any";
    return [...this.inner.valueKinds, "undefined", ...(this.onNull ? (["null"] as const) : [])];
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

export class ArrayType extends Type {
  get rustIsCopy(): boolean {
    return false;
  }
  readonly element: Type;
  constructor(element: Type) {
    super();
    assert(!(element instanceof DefaultType), "an element of an array is never absent, so it has no default");
    assert(
      !reportsByName(withoutModifiers(element)),
      "the converter of a range takes the name of the value, and an element has none",
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
      "an array is a Vec, where the GC does not see JS values: take or return b.jsArray and go through the array in Rust",
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
      "the pairs of a record can be a Vec, where the GC does not see JS values: return b.object and make it with to_js::record",
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
  /** Rust also gets `Name::from_js`. */
  get fromJS(): boolean {
    return false;
  }
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

export interface UnionOptions {
  /** Also generate `Name::from_js`, for Rust that holds a JS value and no typed signature. */
  fromJS?: boolean;
}

export class EnumerationType extends NamedType {
  /** `spellings[i]` all parse to variant `i`; the first is the canonical one. */
  readonly spellings: readonly (readonly string[])[];
  /** Index of the first canonical spelling in `Tables::enumerationValues`. Set by the generator. */
  firstEnumerationValueIndex = -1;
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
  /** Only an own property of the object is read: one it inherits is absent. With `T.ifPassed`, an own `undefined` is not: `T` converts it. */
  own?: boolean;
  /** It is read under this private name of `BunBuiltinNames.h`, which only Bun's own JavaScript can set, and under no other. */
  privateSymbol?: string;
}

export class Member {
  readonly name: string;
  /** The JS names it is read under, in order. None with a `privateSymbol`. */
  readonly names: readonly string[];
  readonly privateSymbol?: string;
  /** Of the field in the generated C++ struct and, keywords aside, in the Rust one. */
  readonly fieldName: string;
  readonly type: Type;
  readonly expected?: readonly string[] | string;
  readonly own: boolean;
  constructor(name: string, spec: Type | MemberOptions) {
    const options: MemberOptions = spec instanceof Type ? { type: spec } : spec;
    this.name = name;
    this.privateSymbol = options.privateSymbol;
    assert(
      !this.privateSymbol || !(options.altNames || options.own),
      `${name}: a privateSymbol is the only name, and is not inherited`,
    );
    this.names = this.privateSymbol ? [] : [name, ...(options.altNames ?? [])];
    for (const name of [this.name, ...this.names])
      assert(/^[A-Za-z_$][\w$]*$/.test(name), `${name}: a member is named by an identifier`);
    this.fieldName = options.rustName ?? snakeCase(name);
    assert(/^[a-z_][a-z0-9_]*$/.test(this.fieldName), `${this.fieldName}: rustName is written in snake_case`);
    assert(!cppKeywords.has(this.fieldName), `${this.fieldName} is a C++ keyword: name the field with rustName`);
    this.type = options.type;
    assert(options.expected === undefined || options.expected.length > 0, `expected: ${name} expects nothing`);
    if (options.expected !== undefined) refuseExpectedOfRange(name, options.type);
    this.expected = options.expected;
    this.own = options.own ?? false;
    assert(
      !isIfPassed(this.type) || (this.own && this.names.length === 1),
      `${name}: .ifPassed is only for an argument or a member with own: true and one name`,
    );
    refuseOutsideArgument(isIfPassed(this.type) ? (this.type as OptionalType).inner : this.type, name);
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
  /** What an error calls the dictionary: `"options"` makes a member `options.level`, and `""` makes it `level`. Defaults to the name of the type. */
  reportedAs?: string;
}

export interface DeferredDictionaryOptions extends Pick<DictionaryOptions, "reportedAs"> {
  /** Rust gets the object, with a method for each member that reads and converts it: the body says when. */
  deferred: true;
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
    assert(this.names.length > 0, "a dictionary needs at least one member");
    assertDistinct(
      this.members.map(member => member.fieldName),
      "fields",
    );
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
    return !!this.options.allowArray;
  }
  get nonObjectAsEmpty(): boolean | "typeof" {
    return this.options.nonObjectAsEmpty ?? false;
  }
  get tsType(): string {
    return this.nonObjectAsEmpty ? `${this.name} | null | undefined` : this.name;
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
  get idlType(): string {
    return `WebCore::IDLDictionary<${this.cpp}>`;
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
  rustOfUndefined(scope: RustScope): string | null {
    return this.nonObjectAsEmpty ? this.toRust({}, scope) : null;
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

/** Any object, as `b.object`. What a member borrows would outlive the call that converts it, as for `.deferred`. */
export class DeferredDictionaryType extends NamedType {
  readonly idlType = objectType.idlType;
  readonly members: readonly Member[];
  readonly conversions: readonly Conversion[];
  readonly #reportedAs: string | undefined;
  /** Index in `Tables::memberNames` of the first name read. Set by the generator. */
  firstMemberNameIndex = -1;
  constructor(members: Record<string, Type | MemberOptions>, options: DeferredDictionaryOptions) {
    super();
    this.#reportedAs = options.reportedAs;
    this.members = Object.entries(members).map(([name, spec]) => new Member(name, spec));
    assert(this.names.length > 0, "a dictionary needs at least one member");
    assertDistinct(
      this.members.map(member => member.fieldName),
      "fields",
    );
    for (const { name, type } of this.members) {
      assert(
        !type.borrowsCell,
        `${name}: an instance that Rust takes as &T is only for an argument, whose slot in the frame keeps it alive`,
      );
    }
    this.conversions = this.members.map((member, index) => {
      const conversion = new Conversion(member.type, member.name, member.expected);
      conversion.member = { of: this, index };
      return conversion;
    });
  }
  get reportedAs(): string {
    return this.#reportedAs ?? this.name;
  }
  /** Every JS name read, in order. */
  get names(): string[] {
    return this.members.flatMap(member => member.names);
  }
  get dependencies(): readonly Type[] {
    return this.members.map(member => member.type);
  }
  get refuses(): string | null {
    return objectType.refuses;
  }
  get holdsJSValue(): boolean {
    return true;
  }
  get returnsValueUnchanged(): boolean {
    return true;
  }
  get rustFromExternThrows(): boolean {
    return false;
  }
  get borrowsFrame(): boolean {
    return false;
  }
  get rustIsCopy(): boolean {
    return true;
  }
  layout(): Layout {
    return objectType.layout();
  }
  rustExternType(): string {
    return objectType.rustExternType();
  }
  rustFromExtern(expr: string, scope: RustScope): string {
    return `${this.path(scope, this.name)}::new(${objectType.rustFromExtern(expr)})`;
  }
}

/** A value goes to the first alternative, in written order, that takes its kind. */
export interface Alternative {
  name: string;
  variant: string;
  type: Type;
  /** It is `alternative` of a union that is itself the alternative `variant`. */
  nested?: { union: UnionType; alternative: Alternative };
}

export class UnionType extends NamedType {
  /** Those of a union that is an alternative take its place: C++ chooses among them all at once, and only the Rust enum nests. */
  readonly alternatives: readonly Alternative[];
  readonly options: UnionOptions;
  constructor(alternatives: Record<string, Type>, options: UnionOptions = {}) {
    super();
    this.options = options;
    this.alternatives = Object.entries(alternatives).flatMap(([name, type]): Alternative[] => {
      const variant = pascalCase(name);
      if (!(type instanceof UnionType))
        return [{ name, variant, type: type instanceof DeferredType ? type.ofArgument(name, undefined) : type }];
      assert(type.conversions.length === 0, `${name}: the union that names a .deferred alternative converts it`);
      return type.alternatives.map(alternative => ({
        name: alternative.name,
        variant,
        type: alternative.type,
        nested: { union: type, alternative },
      }));
    });
    assert(this.alternatives.length > 0, "a union needs at least one alternative");
    assertDistinct(Object.keys(alternatives).map(pascalCase), "variants");
    assertDistinct(
      this.alternatives.map(alternative => alternative.name),
      "alternatives",
    );
    assert(
      !this.borrowsHeap,
      "the bytes of a buffer are only for an argument: they are read after everything else is converted",
    );
    for (const { name, type } of this.alternatives) {
      assert(
        !(type instanceof OptionalType),
        `${name}: add ${type instanceof OptionalType && type.modifier === "otherAsNull" ? "b.ignored" : "b.null"} as an alternative`,
      );
      assert(!(type instanceof DefaultType), `${name}: put .default() on the union`);
      if (type instanceof DeferredType) {
        assert(type.valueKinds !== "any", `${name}: it takes every value, so the union has nothing to choose by`);
        assert(!type.inner.refuses, `${name}: ${type.inner.refuses} is known only once it is converted`);
      } else refuseOutsideArgument(type, name);
      assert(/^[a-z][A-Za-z0-9]*$/.test(name), `${name}: an alternative is named in camelCase`);
      assert(name !== "tag", "tag: the generated struct has a member of that name");
      assert(!cppKeywords.has(name), `${name} is a C++ keyword, and JavaScript never sees the name: pick another`);
    }
    for (const { name, type } of this.alternatives) {
      if (type.valueKinds === "any") continue;
      for (const kind of type.valueKinds) {
        const around = typeof kind === "object" && kindAroundClass(kind);
        const hides =
          around && this.alternatives.find(other => other.type.valueKinds !== "any" && takes(other.type, around));
        assert(!hides, `${name} is never chosen: ${hides && hides.name} takes every ${around}`);
      }
    }
    const chosen = new Set([...this.alternativesByKind.values()].flat());
    this.alternatives.forEach(({ name }, i) =>
      assert(
        chosen.has(i),
        `${name} is never chosen: the alternatives before it take every value it would. Move it earlier or remove it`,
      ),
    );
  }
  get fromJS(): boolean {
    return !!this.options.fromJS;
  }
  /** Those of the `.deferred` alternatives. */
  get conversions(): readonly Conversion[] {
    return this.alternatives.flatMap(({ type }) => (type instanceof DeferredType ? [type.conversion!] : []));
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
  get tsType(): string {
    return this.alternatives.map(a => a.type.tsType).join(" | ");
  }
  get takesUndefined(): boolean {
    return this.alternatives.some(a => a.type.takesUndefined);
  }
  get dependencies(): readonly Type[] {
    return this.alternatives.map(a => a.nested?.union ?? a.type);
  }
  /** `Name::Variant(held)`, or `Name::Variant` if it holds nothing. */
  rustAlternative({ variant, nested }: Alternative, held: string, scope: RustScope): string {
    if (nested) held = nested.union.rustAlternative(nested.alternative, held, scope);
    return `${this.path(scope, this.name)}::${variant}${held && `(${held})`}`;
  }
  /** The alternative `null` or `undefined` goes to: `b.null`, `b.ignored` or `b.opaque`. */
  private alternativeOfAbsent(value: unknown) {
    const alternative = value == null && this.alternatives.find(a => takes(a.type, `${value}`));
    assert(
      alternative &&
        (alternative.type instanceof UnitType || (alternative.type instanceof OpaqueType && value === undefined)),
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
    const alternative = this.alternativeOfAbsent(value);
    const { type } = alternative;
    return this.rustAlternative(alternative, type instanceof UnitType ? "" : type.toRust(value, scope), scope);
  }
  /** The one `undefined` goes to, if that needs no test of the value. */
  get alternativeOfUndefined() {
    const byKind = this.alternativesByKind;
    const offered =
      byKind.get("undefined") ??
      byKind
        .get("other")!
        .filter((i, at, all) => at === all.length - 1 || !refusesNonObjects(this.alternatives[i].type));
    return offered.length === 1 ? this.alternatives[offered[0]] : null;
  }
  rustOfUndefined(scope: RustScope): string | null {
    const alternative = this.alternativeOfUndefined;
    if (!alternative) return null;
    const { type } = alternative;
    const held = type instanceof UnitType ? "" : type.rustOfUndefined(scope);
    return held === null ? null : this.rustAlternative(alternative, held, scope);
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
  /** The function returns a promise: what the body or the conversion of an argument throws rejects one, and nothing is thrown. */
  rejects?: boolean;
  /** A call with fewer arguments throws `ERR_MISSING_ARGS`. Defaults to 0: an argument that was not passed is `undefined`. */
  requiredArguments?: number;
  /** Path of the Rust function. Defaults to the module's path plus the export's name in snake_case. */
  rustPath?: string;
  /** The JS function's `length`. Defaults to the number of required arguments. */
  length?: number;
  /** Node's `ERR_INVALID_ARG_TYPE` for a wrong type: a list is its `(name, expected, actual)`, a string the whole message. */
  expected?: Record<string, readonly string[] | string>;
}

/** What `b.fn` takes. */
export interface FunctionOptions extends SignatureOptions {
  /** Also pass `this`, `this_value: JsLocal<'a>`. */
  passThis?: boolean;
  /** Also pass the function that was called, `callee: JsLocal<'a, JSObject>`. */
  passCallee?: boolean;
  /** The host function has C linkage under this name. C++ declares it with `BUN_DECLARE_HOST_FUNCTION`, and in Rust it is a `JSHostFn` of the generated module. */
  export?: string;
}

/** What `b.value` takes. */
export type ValueOptions = Pick<SignatureOptions, "capability" | "throws" | "rustPath"> & { returns: Type };

export class Signature {
  readonly args: readonly { name: string; type: Type; expected?: readonly string[] | string }[];
  readonly returns: Type;
  readonly capability: Capability;
  readonly throws: boolean;
  readonly rejects: boolean;
  readonly requiredArguments: number;
  readonly rustPath: string | undefined;
  readonly length: number | undefined;
  /** `hasThisValue`: the body is also handed its own JS object. `isProperty`: JS can call it, so each argument is converted from a JS value. */
  constructor(options: SignatureOptions, hasThisValue = false, isProperty = true) {
    this.length = options.length;
    this.rejects = options.rejects ?? false;
    this.requiredArguments = options.requiredArguments ?? 0;
    const { args = {}, expected = {} } = options;
    this.args = Object.entries(args).map(([name, type]) => {
      const expectedOfArgument = Object.hasOwn(expected, name) ? expected[name] : undefined;
      return {
        name,
        type: type instanceof ConvertedByBodyType ? type.ofArgument(name, expectedOfArgument) : type,
        expected: expectedOfArgument,
      };
    });
    for (const [name, types] of Object.entries(expected)) {
      assert(name in args, `expected: ${name} is not an argument`);
      refuseExpectedOfRange(name, args[name]);
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
    for (const { name, type } of this.args.slice(0, -1))
      assert(!(type instanceof RestType), `${name}: b.rest is only for the last argument`);
    for (const { name, type } of this.args) {
      assert(
        !(type instanceof ConvertedByBodyType && type.conversion) || this.capability === "js",
        `${name}: the body converts it, which takes capability: "js"`,
      );
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
      !this.returns.holdsJSValue || this.capability !== "none" || hasThisValue,
      'returning a JS value takes capability: "heap" or "js"',
    );
  }
  /** The arguments up to the last that is not optional, and the `requiredArguments`: what a caller writes at least. */
  get requiredCount(): number {
    return Math.max(this.args.findLastIndex(arg => !arg.type.isOptional) + 1, this.requiredArguments);
  }
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

const reportsByName = (type: Type): boolean =>
  type instanceof RangeType || (type instanceof UnionType && type.alternatives.some(({ type }) => reportsByName(type)));

/** The converter of a range takes no context. */
function refuseExpectedOfRange(name: string, type: Type): void {
  assert(!(withoutModifiers(type) instanceof RangeType), `expected: ${name} is a range, which has its own errors`);
}

function withoutModifiers(type: Type): Type {
  while (type instanceof OptionalType || type instanceof DefaultType || type instanceof WithValueType)
    type = type.inner;
  return type;
}

function refuseResultType(name: string, type: Type): void {
  const result = resultTypeIn(type);
  assert(!result, `${name}: ${result?.refusal}`);
}

/** `b.conversion(T)`: Rust converts a value that is not an argument. */
export class ConversionDefinition {
  readonly type: Type;
  constructor(type: Type) {
    refuseOutsideArgument(type);
    this.type = type;
  }
  exportedAs(name: string, origin: Origin): Conversion {
    const conversion = new Conversion(this.type, name, undefined);
    conversion.rustName = snakeCase(name);
    conversion.symbol = `Bun__Bindgen__${origin.namespace}__${name}`;
    conversion.exported = true;
    return conversion;
  }
}

/** Call a signature, or look at the kind of one more argument. */
export type OverloadDispatch = Signature | { argument: number; byKind: Map<ValueKind | "other", OverloadDispatch> };

export class FunctionDefinition {
  readonly signatures: readonly Signature[];
  readonly dispatch: OverloadDispatch;
  readonly passThis: boolean;
  readonly passCallee: boolean;
  readonly exportName: string | undefined;
  /** `b.value`: there is no JS function. */
  readonly isValue: boolean;
  name = "";
  origin: Origin | null = null;
  constructor(signatures: readonly (SignatureOptions | Signature)[], options: FunctionOptions = {}, isValue = false) {
    this.isValue = isValue;
    assert(signatures.length > 0, "b.overloads needs at least one signature");
    this.passThis = options.passThis ?? false;
    this.passCallee = options.passCallee ?? false;
    this.exportName = options.export;
    for (const key of ["passThis", "passCallee", "export"] as const) {
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
    assert(
      this.exportName === undefined || this.signatures.every(signature => signature.length === undefined),
      "length: what makes an exported function gives its length",
    );
    for (const key of ["rejects", "requiredArguments"] as const)
      assert(
        this.signatures.every(signature => signature[key] === this.signatures[0][key]),
        `every overload gives ${key} the same value`,
      );
    assert(
      this.signatures.length === 1 ||
        !this.signatures.some(signature => signature.args.some(arg => isIfPassed(arg.type))),
      ".ifPassed is not for overloads: the kind of an argument chooses one, and an argument that is not passed has none",
    );
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
  get length(): number {
    const given = this.signatures.find(signature => signature.length !== undefined);
    return given?.length ?? Math.min(...this.signatures.map(signature => signature.requiredCount));
  }
}

// ───────────────────────────── classes ─────────────────────────────

/** A native function. */
export interface FunctionField extends Omit<SignatureOptions, "rustPath"> {
  /** `&mut self` instead of `&self`. No member of such a class has `capability: "js"`, and the class is not an argument type. */
  mutates?: boolean;
  /** Also pass the wrapper, `this_value: JsWrapper<'a, Self>`. */
  passThis?: boolean;
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
  /** Each is `b.opaque`, `b.bool`, a number or `b.byteSpan`. */
  args?: Record<string, Type>;
  /** `b.opaque`, `b.bool`, a number, or nothing. */
  returns?: Type;
  /** With this or `throws`, `globalObject` is the first parameter. */
  capability?: Capability;
  /** It returns `b.opaque`, which is empty if it threw, or nothing. */
  throws?: boolean;
}

/** A member function of the generated C++ class that is defined in hand-written C++. */
export interface CalledFromRustField {
  /** Each is `b.opaque`, `b.bool` or a number. */
  args?: Record<string, Type>;
  /** `b.opaque`, or nothing. */
  returns?: Type;
  /** `"heap"`: it allocates JS values. `"js"`: it runs JavaScript. With either or `throws`, `globalObject` is the first parameter, and `global` follows `this_value` in Rust. */
  capability?: Capability;
  /** The Rust function returns a `JsResult`. */
  throws?: boolean;
}

export interface GetterField {
  getter: Type;
  /** Also generate a setter. In a class that has a `mutates` member it takes `&mut self`. Its `capability` and the `type` it takes are the getter's unless it names its own. */
  setter?: true | { capability?: Capability; type?: Type };
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
  /** Defaults to the class's. */
  enumerable?: boolean;
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

/** An integer that every instance shares, like a WebIDL `const`: a read-only data property. */
export interface ConstantField {
  constant: number;
  /** Defaults to the class's. */
  configurable?: boolean;
  /** Defaults to the class's. */
  enumerable?: boolean;
}

/** Several functions are the overloads of one. `rustName` tells their Rust functions apart. A key that starts with `@@` is a well-known symbol: `@@iterator` is `Symbol.iterator`. */
export type Field =
  FunctionField | readonly FunctionField[] | GetterField | InternalFieldField | BuiltinField | ConstantField;
export type StaticField =
  | Omit<FunctionField, "mutates" | "passThis" | "invalidThis" | "privateSymbol" | "name" | "calledFromCpp">
  | Omit<GetterField, "cache" | "writable" | "passThis">;

export interface ConstructOptions extends Omit<SignatureOptions, "rustPath" | "returns"> {
  /** The constructor creates the object itself, with `structure.create(..)`, and returns it: it can then set internal fields. */
  passStructure?: boolean;
}

export interface ClassOptions {
  /** Path of the Rust struct. The members are its own methods. */
  rustPath: string;
  /** The struct is intrusively refcounted and the JS object holds one ref, so it can outlive the object. Every member takes `&self`. */
  refCounted?: boolean;
  /** With `refCounted`: call `fn finalize(&self)` when the object is collected, before its ref is dropped. */
  finalize?: boolean;
  /** `false`: hand-written C++ can subclass `JSName`, and an instance of the subclass is an instance of this class. With `refCounted`. */
  final?: boolean;
  /** `impl bun_jsc::JsClass` is not generated: write it by hand, calling `js_Name::to_js` and `js_Name::from_js`. With `refCounted`. */
  overridesToJS?: boolean;
  /** JavaScript only sees a function bound to the instance. Members are called with that function as `this` and get its `boundThis`. */
  forBind?: boolean;
  /** Traits to bring into scope, for members that are trait methods. */
  rustTraits?: readonly string[];
  /** The prototype inherits from `Error.prototype` instead of `Object.prototype`, and its `name` is the class's. */
  prototypeBase?: "Error";
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
  /**
   * JS values the object holds, empty at first. The GC visits them; `js_Name` gets `x_get_cached` / `x_set_cached` / `x_take_cached` for each.
   * In a record each field names its type: `b.opaque` is what a list declares, and `b.cell("JSC::JSPromise", ..)` makes `m_x` a `WriteBarrier<JSC::JSPromise>` that only hand-written C++ uses.
   */
  internalFields?: readonly string[] | Readonly<Record<string, OpaqueType | CellType>>;
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
/** `iterator` for the key `@@iterator`, `undefined` for a key that is not a well-known symbol. */
export const wellKnownSymbol = (name: string) => (name.startsWith("@@") ? name.slice(2) : undefined);

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
const isPassedAsIs = (type: Type) => type instanceof OpaqueType || type instanceof PrimitiveType;

export class Method extends Signature {
  readonly name: string;
  readonly rustName: string;
  readonly hasDefaultRustName: boolean;
  readonly receiver: Receiver;
  readonly passThis: boolean;
  readonly invalidThis: "throw" | "undefined";
  readonly privateSymbol: string | undefined;
  readonly functionName: string | undefined;
  readonly calledFromCpp: boolean;
  /** A property of the prototype or the constructor, so JS can call it. */
  readonly isProperty: boolean;
  constructor(name: string, options: FunctionField, isStatic = false, sharedThis = false, isProperty = true) {
    super(options, !isStatic && !!options.passThis, isProperty);
    this.name = name;
    this.isProperty = isProperty;
    this.calledFromCpp = !!options.calledFromCpp;
    if (this.calledFromCpp) {
      refuseCppMemberFunctionNames(name, this.args);
      assert(!this.args.some(arg => arg.type instanceof RestType), `${name}: a calledFromCpp function has no b.rest`);
      assert(!this.rejects, `${name}: a calledFromCpp function throws, so it has no rejects`);
    }
    if (!isProperty) {
      for (const arg of this.args)
        assert(
          isPassedAsIs(arg.type) || arg.type instanceof ByteSpanType,
          `${name}: ${arg.name} is b.opaque, b.bool, a number or b.byteSpan`,
        );
      assert(
        this.returns instanceof UnitType || isPassedAsIs(this.returns),
        `${name}: returns b.opaque, b.bool, a number or nothing`,
      );
      assert(
        !this.throws || !(this.returns instanceof PrimitiveType),
        `${name}: a function that throws returns b.opaque or nothing`,
      );
    }
    this.rustName = memberRustName(options.rustName ?? snakeCase(memberIdentifier(name)));
    this.hasDefaultRustName = options.rustName === undefined;
    refuseReentrancy(name, isStatic, sharedThis, this.capability);
    this.receiver = memberReceiver(isStatic, sharedThis, !!options.mutates);
    this.passThis = !isStatic && !!options.passThis;
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
    for (const arg of this.args) assert(isPassedAsIs(arg.type), `${name}: ${arg.name} is b.opaque, b.bool or a number`);
    assert(
      options.returns === undefined || options.returns instanceof OpaqueType,
      `${name}: returns b.opaque or nothing`,
    );
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
  readonly setterType: Type;
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
  readonly enumerable: boolean | undefined;
  constructor(name: string, options: GetterField, isStatic = false, sharedThis = false) {
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
    refuseReentrancy(name, isStatic, sharedThis, this.capability);
    refuseReentrancy(name, isStatic, sharedThis, this.setterCapability);
    this.receiver = memberReceiver(isStatic, sharedThis, false);
    this.setterReceiver = memberReceiver(isStatic, sharedThis, true);
    this.passThis = !!options.passThis;
    assert(!(this.passThis && isStatic), `${name}: a static getter has no passThis`);
    this.throws = options.throws ?? false;
    this.hasSetter = !!options.setter;
    this.writable = !!options.writable;
    assert(!this.writable || options.cache, `${name}: writable is only for a cached getter`);
    assert(
      !(this.writable && this.hasSetter),
      `${name}: writable stores the value itself, so there is no setter to call`,
    );
    assert(
      !(options.cache && this.hasSetter && !this.passThis),
      `${name}: the setter of a cached getter takes passThis, to replace the cached value`,
    );
    if (this.hasSetter) refuseResultType(name, this.setterType);
    assert(!(isStatic && options.cache), `${name}: a static getter has no cache`);
    assert(
      !this.type.holdsJSValue || this.capability !== "none" || this.passThis,
      `${name}: returning a JS value takes capability: "heap" or "js"`,
    );
    this.internalField = options.cache === true ? name : options.cache;
    this.declaresInternalField = options.cache === true;
    this.configurable = options.configurable;
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

export type ClassMember = FunctionDefinition | Getter | InternalFieldAccessor | Builtin | Constant;

/** Stands for the class being declared, in its own signatures. */
class SelfType extends Type {
  readonly idlType = "";
  readonly tsType = "this";
  /** The class that takes its place is told by its kind. */
  get valueKinds(): ValueKinds {
    return [];
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
  readonly rustPath: string;
  readonly refCounted: boolean;
  /** No member has `mutates`, so every member takes `&self`. */
  readonly sharedThis: boolean;
  readonly finalize: boolean;
  readonly construct: Signature | null;
  readonly passStructure: boolean;
  readonly call: FunctionDefinition | null;
  readonly memoryCost: boolean;
  readonly estimatedSize: boolean;
  readonly overridesToJS: boolean;
  readonly final: boolean;
  readonly rustTraits: readonly string[];
  readonly forBind: boolean;
  readonly illegalConstructor: boolean;
  /** The native functions of the prototype. The signatures of each are `Method`s. */
  readonly functions: readonly FunctionDefinition[];
  readonly getters: readonly Getter[];
  readonly internalFieldAccessors: readonly InternalFieldAccessor[];
  readonly staticFunctions: readonly FunctionDefinition[];
  readonly staticGetters: readonly Getter[];
  readonly builtins: readonly Builtin[];
  readonly constants: readonly Constant[];
  readonly calledFromCpp: readonly Method[];
  readonly calledFromRust: readonly CalledFromRustFunction[];
  /** The properties of the prototype and of the constructor, as written. */
  readonly protoMembers: readonly ClassMember[];
  readonly staticMembers: readonly ClassMember[];
  /** The schema's, then those of `cache: true` getters. */
  readonly internalFields: readonly string[];
  /** The `b.cell` internal fields. */
  readonly internalFieldClasses: ReadonlyMap<string, CellType>;
  readonly configurable: boolean;
  readonly enumerable: boolean;
  readonly writable: boolean;
  readonly prototypeBase: "Error" | undefined;
  /** Index in `AdditionsToGlobalObject::m_classes`. Set by the generator. */
  classIndex = -1;
  constructor(options: ClassOptions) {
    super();
    this.rustPath = options.rustPath;
    this.refCounted = options.refCounted ?? false;
    this.finalize = options.finalize ?? false;
    assert(this.refCounted || !this.finalize, "finalize is only for a refCounted class: otherwise implement Drop");
    this.sharedThis = !Object.values(options.proto ?? {})
      .flat()
      .some(field => "mutates" in field && field.mutates);
    assert(this.sharedThis || !this.refCounted, "a refCounted class has no mutates: every member takes &self");
    assert(
      this.sharedThis || !options.estimatedSize,
      "estimatedSize: a marking thread would read the struct while a mutates member writes it",
    );
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
    assert(
      this.refCounted || this.final,
      "final: false is only for a refCounted class: otherwise the struct is stored in the object, where a subclass's fields would go",
    );
    this.rustTraits = options.rustTraits ?? [];
    this.forBind = options.forBind ?? false;
    assert(
      !(this.forBind && options.prototypeBase),
      "forBind has no prototypeBase: the prototype inherits from Function.prototype",
    );
    const members = (fields: Record<string, Field>, isStatic: boolean) =>
      Object.entries(fields).map(([name, field]): ClassMember => {
        assert(
          !wellKnownSymbol(name) ||
            !("builtin" in field || "internalField" in field || "getter" in field || "constant" in field),
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
        if ("constant" in field) {
          assert(!isStatic, `${name}: a constant is a property of the prototype`);
          return new Constant(name, field);
        }
        if ("getter" in field) {
          assert(!("args" in field || "returns" in field), `${name}: a getter has no args or returns`);
          return new Getter(name, { ...field, getter: own(field.getter) }, isStatic, this.sharedThis);
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
          overloads.map(overload => new Method(name, resolve(overload), isStatic, this.sharedThis)),
        );
        fn.name = name;
        return fn;
      });
    this.protoMembers = members(options.proto ?? {}, false);
    this.staticMembers = members(options.static ?? {}, true);
    assert(this.construct || !options.call, "call needs a constructor object: add construct");
    this.call = options.call ? (members({ call: options.call }, true)[0] as FunctionDefinition) : null;
    this.calledFromCpp = Object.entries(options.calledFromCpp ?? {}).map(
      ([name, field]) => new Method(name, { ...field, calledFromCpp: true }, false, this.sharedThis, false),
    );
    this.calledFromRust = Object.entries(options.calledFromRust ?? {}).map(
      ([name, field]) => new CalledFromRustFunction(name, field),
    );
    this.functions = this.protoMembers.filter(member => member instanceof FunctionDefinition);
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
      ...getters.filter(getter => getter.declaresInternalField).map(getter => getter.name),
    ];
    const internalFieldClasses = new Map<string, CellType>();
    if (!Array.isArray(declaredFields))
      for (const [field, type] of Object.entries(declaredFields)) {
        assert(
          type instanceof OpaqueType || type instanceof CellType,
          `${field}: an internal field is b.opaque or b.cell`,
        );
        if (type instanceof CellType) internalFieldClasses.set(field, type);
      }
    this.internalFieldClasses = internalFieldClasses;
    for (const { name, internalField } of [...getters, ...this.internalFieldAccessors]) {
      assert(
        internalField === undefined || this.internalFields.includes(internalField),
        `${name}: there is no internal field ${internalField}`,
      );
      assert(
        internalField === undefined || !this.internalFieldClasses.has(internalField),
        `${name}: ${internalField} is a b.cell field, which only C++ reads and writes`,
      );
    }
    for (const field of this.internalFields)
      assert(/^[a-z][A-Za-z0-9]*$/.test(field), `${field}: an internal field is named in camelCase`);
    // A `rustName` may be another member's function.
    assertDistinct(
      [
        "constructor",
        ...this.methods.filter(method => method.hasDefaultRustName).map(method => method.rustName),
        ...[...getters, ...this.staticGetters]
          .filter(getter => getter.hasDefaultRustName)
          .flatMap(getter => [getter.rustName, ...(getter.hasSetter ? [getter.setterRustName] : [])]),
      ],
      "members' Rust functions",
    );
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
    this.configurable = options.configurable ?? false;
    this.enumerable = options.enumerable ?? true;
    this.writable = options.writable ?? true;
    this.prototypeBase = options.prototypeBase;
  }
  /** The prototype's and the constructor's functions, and `call`. */
  get nativeFunctions(): readonly FunctionDefinition[] {
    return [...this.functions, ...this.staticFunctions, ...(this.call ? [this.call] : [])];
  }
  /** Every signature that a Rust function implements. */
  get methods(): readonly Method[] {
    return [...this.nativeFunctions.flatMap(fn => fn.signatures as readonly Method[]), ...this.calledFromCpp];
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
    return true;
  }
  get tryConvertThrows(): boolean {
    return false;
  }
  get nullRepresentation() {
    return "pointer" as const;
  }
  /** Signatures are not dependencies: a class may mention itself. */
  get signatureTypes(): Type[] {
    return [
      ...(this.construct ? this.construct.args.map(arg => arg.type) : []),
      ...this.methods.flatMap(method => [...method.args.map(arg => arg.type), method.returns]),
      ...[...this.getters, ...this.staticGetters].flatMap(getter => [getter.type, getter.setterType]),
    ];
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
  constructor(
    functions: Record<string, SignatureOptions | readonly SignatureOptions[]>,
    options: NamespaceOptions = {},
  ) {
    this.functions = Object.entries(functions).map(([name, options]) => {
      assert(/^[A-Za-z_$][\w$]*$/.test(name), `${name}: a function is named by an identifier`);
      assert(!(options instanceof FunctionDefinition), `${name}: write what b.fn takes, without b.fn`);
      const signatures: readonly SignatureOptions[] = Array.isArray(options) ? options : [options];
      for (const key of ["passThis", "passCallee", "export"])
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

export class ModuleDefinition {
  /** Rust path the file's functions live under, e.g. `crate::node::node_os`. */
  readonly rustPath: string;
  constructor(options: { rustPath: string }) {
    this.rustPath = options.rustPath;
  }
}
