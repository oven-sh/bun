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

export const roundUp = (n: number, align: number) => Math.ceil(n / align) * align;

export function structLayout(fields: readonly Layout[]): Layout {
  let size = 0;
  let align = 1;
  for (const field of fields) {
    size = roundUp(size, field.align) + field.size;
    align = Math.max(align, field.align);
  }
  return { size: roundUp(size, align), align };
}

/** `ExternVariant<...>`: `{ union data; uint8_t tag; }`. */
export function variantLayout(alternatives: readonly Layout[]): Layout {
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
  "as break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while async await dyn gen".split(
    " ",
  ),
);
export const rustIdent = (name: string) => (rustKeywords.has(name) ? `r#${name}` : name);

export function asciiLiteral(value: string): string {
  assert(!/[^\x20-\x7e]/.test(value), `must be printable ASCII: ${util.inspect(value)}`);
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"_s`;
}

export abstract class Type {
  /** `undefined` means "not provided". */
  get optional(): OptionalType {
    return new OptionalType(this, "optional");
  }
  /** `null` or `undefined` means "not provided". */
  get nullable(): OptionalType {
    return new OptionalType(this, "nullable");
  }
  /** Every falsy value means "not provided". */
  get falsyAsNull(): OptionalType {
    return new OptionalType(this, "falsyAsNull");
  }
  /** Converted for use now, and the value itself for whatever holds it longer. Only for arguments. */
  get withValue(): WithValueType {
    return new WithValueType(this);
  }
  /** Value to use when not provided. Only for arguments and dictionary members. */
  default(value: unknown): DefaultType {
    return new DefaultType(this, value);
  }

  /** The C++ tag type whose `WebCore::Converter` turns a JSValue into a C++ value. */
  abstract readonly idlType: string;
  /** TypeScript spelling. */
  abstract readonly tsType: string;

  /** How `IDLNullable<this>::ImplementationType` says "null". */
  get nullRepresentation(): "optional" | "pointer" {
    return "optional";
  }
  /** Converting `undefined` succeeds, so a dictionary member of this type is not required. */
  get permitsUndefined(): boolean {
    return false;
  }
  /** Holds a JS value: the Rust type is branded with the call. */
  get holdsJSValue(): boolean {
    return this.dependencies.some(type => type.holdsJSValue);
  }
  /** Points into memory JavaScript can detach, resize or free: not for a function that can run it. */
  get borrowsHeap(): boolean {
    return this.dependencies.some(type => type.borrowsHeap);
  }
  /** Points into the C++ thunk's frame: only usable for the duration of a host call. */
  get borrowsFrame(): boolean {
    return this.dependencies.some(type => type.borrowsFrame);
  }
  /** `rustType` is `Copy`. */
  get rustIsCopy(): boolean {
    return this.dependencies.length > 0 && this.dependencies.every(type => type.rustIsCopy);
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
  abstract toCpp(value: unknown): string;
  /** The same value as a Rust expression of `rustType`. */
  toRust(value: unknown, scope: RustScope): string {
    throw new TypeError(`${this.tsType} cannot have a default`);
  }
  /** A C++ expression that converts `value`. `ctx` is a conversion context, `name` what to call the value. */
  cppConvert(value: string, ctx: string, name: string): string {
    return `::Bun::convertIDL<${this.idlType}>(*globalObject, ${value}, ${ctx})`;
  }

  abstract layout(): Layout;
  /** The Rust mirror of what `Bun::Bindgen::ExternTraits` lowers the C++ value to. */
  abstract rustExternType(scope: RustScope): string;
  /** What a Rust body sees. */
  abstract rustType(scope: RustScope): string;
  /** A Rust expression (inside `unsafe`) that consumes `expr`, a `rustExternType`. */
  rustFromExtern(expr: string, scope: RustScope): string {
    return expr;
  }

  /** The type of a field of a returned dictionary. */
  rustResultFieldType(scope: RustScope): string {
    return this.rustType(scope);
  }
  /** The return type of a trait method. */
  rustReturnType(scope: RustScope): string {
    return this.rustResultFieldType(scope);
  }
  /** A Rust expression of type `bindgen::Result<'a, bindgen::JsValue<'a>>` that consumes `value`; `heap` is in scope. */
  rustToJS(value: string, scope: RustScope): string {
    throw new TypeError(`${this.tsType} cannot be returned to JavaScript`);
  }
}

// ───────────────────────────── primitives ─────────────────────────────

class PrimitiveType extends Type {
  get rustIsCopy(): boolean {
    return true;
  }
  readonly idlType: string;
  readonly tsType: string;
  readonly rustName: string;
  readonly size: number;
  constructor(idlType: string, tsType: string, rustName: string, size: number) {
    super();
    this.idlType = idlType;
    this.tsType = tsType;
    this.rustName = rustName;
    this.size = size;
  }
  toCpp(value: unknown): string {
    if (this.rustName === "bool") {
      assert(typeof value === "boolean");
      return String(value);
    }
    assert(typeof value === "number");
    if (this.rustName !== "f64") assert(Number.isSafeInteger(value));
    return `${this.idlType}::ImplementationType { ${value} }`;
  }
  toRust(value: unknown): string {
    return this.rustName === "f64" && Number.isInteger(value) ? `${value}.0` : String(value);
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
  constructor(idlType = "::Bun::IDLStrictBoolean") {
    super(idlType, "boolean", "bool", 1);
  }
  /** `ToBoolean`: any value is accepted. */
  get loose(): BoolType {
    return new BoolType("::WebCore::IDLBoolean");
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
  constructor(info: IntegerInfo, idlType = `::Bun::IDLStrictInteger<${info.cpp}>`) {
    super(idlType, "number", info.rust, info.size);
    this.info = info;
  }
  /** `ToNumeric` first, then as strict as the default. */
  get loose(): IntegerType {
    return new IntegerType(this.info, `::Bun::IDLLooseInteger<${this.info.cpp}>`);
  }
  /** WebIDL conversion: `ToNumber`, then wrap modulo the width. */
  get wrap(): IntegerType {
    return new IntegerType(this.info, `::WebCore::${this.info.webidl}`);
  }
  /** WebIDL `[EnforceRange]` over `[min, max]`. */
  enforceRange(min = Number(this.info.min), max = Number(this.info.max)): RangeType {
    return new RangeType(this.info, min, max, "Web");
  }
  /** Node's `validateInteger` / `validateInt32` / `validateUint32`: `ERR_INVALID_ARG_TYPE`, `ERR_OUT_OF_RANGE`. */
  validateInteger(min = Number(this.info.min), max = Number(this.info.max)): RangeType {
    return new RangeType(this.info, min, max, "Node");
  }
}

export class RangeType extends IntegerType {
  readonly kind: "Web" | "Node";
  constructor(info: IntegerInfo, min: number, max: number, kind: "Web" | "Node") {
    assert(Number.isSafeInteger(min) && Number.isSafeInteger(max) && min <= max);
    assert(min >= Number(info.min) && max <= Number(info.max), `range does not fit ${info.rust}`);
    super(
      info,
      `::Bun::BindgenCustomEnforceRange<${info.cpp}, ${min}, ${max}, ::Bun::BindgenCustomEnforceRangeKind::${kind}>`,
    );
    this.kind = kind;
  }
  getHeaders(out: Set<string>): void {
    out.add("BindgenCustomEnforceRange.h");
  }
  cppConvert(value: string, ctx: string, name: string): string {
    return this.kind === "Node"
      ? `::WebCore::convert<${this.idlType}>(*globalObject, ${value}, []() { return ${asciiLiteral(name)}; })`
      : `::WebCore::convert<${this.idlType}>(*globalObject, ${value})`;
  }
}

const integer = (rust: string, cpp: string, size: number, webidl: string, min: number | bigint, max: number | bigint) =>
  new IntegerType({ rust, cpp: `::std::${cpp}`, size, webidl, min, max });

export const integers = {
  u8: integer("u8", "uint8_t", 1, "IDLOctet", 0, 255),
  u16: integer("u16", "uint16_t", 2, "IDLUnsignedShort", 0, 65535),
  i32: integer("i32", "int32_t", 4, "IDLLong", -2147483648, 2147483647),
  u32: integer("u32", "uint32_t", 4, "IDLUnsignedLong", 0, 4294967295),
  u64: integer("u64", "uint64_t", 8, "IDLUnsignedLongLong", 0, Number.MAX_SAFE_INTEGER),
  usize: integer("usize", "uint64_t", 8, "IDLUnsignedLongLong", 0, Number.MAX_SAFE_INTEGER),
};

export class DoubleType extends PrimitiveType {
  constructor() {
    super("::Bun::IDLStrictDouble", "number", "f64", 8);
  }
}

/** Only as a union alternative or a return type. */
export class UnitType extends Type {
  get rustIsCopy(): boolean {
    return true;
  }
  readonly idlType: string;
  readonly tsType: string;
  constructor(tsType: "null" | "undefined") {
    super();
    this.tsType = tsType;
    this.idlType = tsType === "null" ? "::Bun::IDLStrictNull" : "::Bun::IDLStrictUndefined";
  }
  get permitsUndefined(): boolean {
    return true;
  }
  toCpp(): string {
    return this.tsType === "null" ? "nullptr" : "::std::monostate {}";
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
    assert(this.tsType === "undefined", "leave `returns` out, or return a nullable type");
    return `bindgen::to_js::undefined(heap, ${value})`;
  }
}

// ───────────────────────────── strings, values, buffers ─────────────────────────────

/** An owned `bun_core::String` sharing the JS string's `StringImpl`. */
export class StringType extends Type {
  readonly idlType: string;
  readonly tsType = "string";
  constructor(idlType = "::Bun::IDLStrictString") {
    super();
    this.idlType = idlType;
  }
  /** `ToString`: any value is accepted. */
  get loose(): StringType {
    return new StringType("::WebCore::IDLDOMString");
  }
  /** `&[u8]`, UTF-8, for the duration of the call, instead of an owned string. Also takes a `String` object. */
  get utf8(): Utf8Type {
    const isLoose = this.idlType === "::WebCore::IDLDOMString";
    return new Utf8Type(`::Bun::Bindgen::IDL${isLoose ? "Loose" : "Strict"}UTF8String`);
  }
  get nullRepresentation() {
    return "pointer" as const;
  }
  toCpp(value: unknown): string {
    assert(typeof value === "string");
    return `::WTF::String { ${asciiLiteral(value)} }`;
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

/** UTF-8 to keep: the JS string's own buffer, shared, when it is 8-bit ASCII, otherwise a transcoded copy. */
export class OwnedUtf8Type extends StringType {
  toRust(): string {
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
  get rustIsCopy(): boolean {
    return true;
  }
  readonly idlType: string;
  readonly tsType = "string";
  constructor(idlType: string) {
    super();
    this.idlType = idlType;
  }
  /** `bun_core::Utf8Bytes<'static>`, for a body that stores the string. */
  get owned(): OwnedUtf8Type {
    const isLoose = this.idlType === "::Bun::Bindgen::IDLLooseUTF8String";
    return new OwnedUtf8Type(isLoose ? "::WebCore::IDLDOMString" : "::Bun::Bindgen::IDLStrictStringOrStringObject");
  }
  get borrowsFrame(): boolean {
    return true;
  }
  get nullRepresentation() {
    return "pointer" as const;
  }
  toCpp(value: unknown): string {
    assert(typeof value === "string");
    return `::Bun::Bindgen::JSStringUTF8View { ${asciiLiteral(value)} }`;
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
    return `${expr}.get()`;
  }
  rustResultFieldType(): string {
    return "Vec<u8>";
  }
  rustReturnType(): string {
    return "impl AsRef<[u8]>";
  }
  rustToJS(value: string): string {
    return `bindgen::to_js::utf8(heap, ${value})`;
  }
}

/** The bytes of a typed array, `DataView` or `ArrayBuffer`, as `&[u8]`. */
export class BytesType extends Type {
  get rustIsCopy(): boolean {
    return true;
  }
  readonly idlType = "::Bun::Bindgen::IDLBufferSourceBytes";
  readonly tsType = "ArrayBuffer | ArrayBufferView";
  get borrowsHeap(): boolean {
    return true;
  }
  get nullRepresentation() {
    return "pointer" as const;
  }
  toCpp(): string {
    throw new TypeError("b.bufferSource.bytes cannot have a default");
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
    return `${expr}.get()`;
  }
}

/** A typed array, `DataView` or `ArrayBuffer`, as a handle whose bytes are read through `with_bytes`. */
export class BufferSourceType extends Type {
  get rustIsCopy(): boolean {
    return true;
  }
  readonly idlType = "::Bun::Bindgen::IDLRawBufferSource";
  readonly tsType = "ArrayBuffer | ArrayBufferView";
  /** `&[u8]` for the duration of the call. Not for `capability: "js"`, where JavaScript could detach it. */
  get bytes(): BytesType {
    return new BytesType();
  }
  /** A reference on the `JSC::ArrayBuffer` behind it, which can be stored. */
  get arrayBuffer(): RefType {
    return new RefType("::Bun::IDLArrayBufferRef", this.tsType, "bun_jsc::JSCArrayBuffer", null);
  }
  get holdsJSValue(): boolean {
    return true;
  }
  toCpp(): string {
    throw new TypeError("b.bufferSource cannot have a default");
  }
  layout(): Layout {
    return { size: 8, align: 8 };
  }
  rustExternType(): string {
    return "JSValue";
  }
  rustType(): string {
    return "bindgen::JsValue<'a, bun_jsc::ArrayBuffer>";
  }
  rustFromExtern(expr: string): string {
    return `bindgen::JsValue::from_extern(${expr})`;
  }
  rustToJS(value: string): string {
    return `bindgen::to_js::any(heap, ${value})`;
  }
}

/** Converts as `inner` does; the thunk passes the argument itself along. */
export class WithValueType extends Type {
  readonly inner: Type;
  constructor(inner: Type) {
    super();
    assert(!(inner instanceof DefaultType), ".withValue cannot be combined with .default()");
    assert(!(inner instanceof WithValueType), "already .withValue");
    this.inner = inner;
  }
  get idlType(): string {
    return this.inner.idlType;
  }
  get tsType(): string {
    return this.inner.tsType;
  }
  get permitsUndefined(): boolean {
    return this.inner.permitsUndefined;
  }
  get holdsJSValue(): boolean {
    return true;
  }
  get dependencies(): readonly Type[] {
    return [this.inner];
  }
  toCpp(): string {
    throw new TypeError(".withValue cannot be combined with .default()");
  }
  cppConvert(value: string, ctx: string, name: string): string {
    return this.inner.cppConvert(value, ctx, name);
  }
  layout(): Layout {
    return structLayout([this.inner.layout(), { size: 8, align: 8 }]);
  }
  rustExternType(scope: RustScope): string {
    return `bindgen::extern_types::ExternWithValue<${this.inner.rustExternType(scope)}>`;
  }
  rustType(scope: RustScope): string {
    return `bindgen::WithValue<'a, ${this.inner.rustType(scope)}>`;
  }
  rustFromExtern(expr: string, scope: RustScope): string {
    return `{ let with_value = ${expr}; bindgen::WithValue { converted: ${this.inner.rustFromExtern("with_value.converted", scope)}, value: bindgen::JsValue::from_extern(with_value.value) } }`;
  }
}

export class AnyType extends Type {
  get rustIsCopy(): boolean {
    return true;
  }
  readonly idlType = "::Bun::IDLRawAny";
  readonly tsType = "any";
  get holdsJSValue(): boolean {
    return true;
  }
  get permitsUndefined(): boolean {
    return true;
  }
  toCpp(): string {
    throw new TypeError("b.any cannot have a default");
  }
  toRust(): string {
    return "bindgen::JsValue::UNDEFINED";
  }
  layout(): Layout {
    return { size: 8, align: 8 };
  }
  rustExternType(): string {
    return "JSValue";
  }
  rustType(): string {
    return "bindgen::JsValue<'a>";
  }
  rustFromExtern(expr: string): string {
    return `bindgen::JsValue::from_extern(${expr})`;
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
  constructor(idlType: string, tsType: string, pointee: string, header: string | null) {
    super();
    this.idlType = idlType;
    this.tsType = tsType;
    this.pointee = pointee;
    this.header = header;
  }
  get nullRepresentation() {
    return "pointer" as const;
  }
  getHeaders(out: Set<string>): void {
    if (this.header) out.add(this.header);
  }
  toCpp(): string {
    throw new TypeError(`${this.tsType} cannot have a default`);
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

// ───────────────────────────── combinators ─────────────────────────────

export class OptionalType extends Type {
  readonly payload: Type;
  readonly kind: "optional" | "nullable" | "falsyAsNull";
  constructor(payload: Type, kind: "optional" | "nullable" | "falsyAsNull") {
    super();
    assert(!(payload instanceof OptionalType), "already optional");
    assert(!(payload instanceof DefaultType), "put .default() last");
    assert(!(payload instanceof AnyType), "b.any already accepts undefined and null");
    assert(!(payload instanceof WithValueType), "put .withValue last");
    this.payload = payload;
    this.kind = kind;
  }
  get idlType(): string {
    const template = {
      optional: "::WebCore::IDLOptional",
      nullable: "::WebCore::IDLNullable",
      falsyAsNull: "::Bun::IDLLooseNullable",
    }[this.kind];
    return `${template}<${this.payload.idlType}>`;
  }
  get tsType(): string {
    return `${this.payload.tsType} | ${this.kind === "optional" ? "undefined" : "null | undefined"}`;
  }
  get permitsUndefined(): boolean {
    return true;
  }
  get dependencies(): readonly Type[] {
    return [this.payload];
  }
  toCpp(value: unknown): string {
    return value == null ? `${this.idlType}::nullValue()` : this.payload.toCpp(value);
  }
  toRust(value: unknown, scope: RustScope): string {
    return value == null ? "None" : `Some(${this.payload.toRust(value, scope)})`;
  }
  layout(): Layout {
    return this.payload.nullRepresentation === "optional"
      ? variantLayout([{ size: 1, align: 1 }, this.payload.layout()])
      : this.payload.layout();
  }
  rustExternType(scope: RustScope): string {
    return this.payload.nullRepresentation === "optional"
      ? `bindgen::extern_types::ExternOptional<${this.payload.rustExternType(scope)}>`
      : this.payload.rustExternType(scope);
  }
  rustType(scope: RustScope): string {
    return `Option<${this.payload.rustType(scope)}>`;
  }
  rustFromExtern(expr: string, scope: RustScope): string {
    if (this.payload.nullRepresentation === "optional") {
      const inner = this.payload.rustFromExtern("value", scope);
      return inner === "value" ? `${expr}.get()` : `${expr}.get().map(|value| ${inner})`;
    }
    if (this.payload instanceof Utf8Type || this.payload instanceof BytesType) return `${expr}.get_optional()`;
    return `{ let value = ${expr}; if value.is_null() { None } else { Some(${this.payload.rustFromExtern("value", scope)}) } }`;
  }
  rustResultFieldType(scope: RustScope): string {
    return `Option<${this.payload.rustResultFieldType(scope)}>`;
  }
  rustReturnType(scope: RustScope): string {
    return `Option<${this.payload.rustReturnType(scope)}>`;
  }
  rustToJS(value: string, scope: RustScope): string {
    const none = this.kind === "optional" ? "UNDEFINED" : "NULL";
    return `match ${value} { Some(value) => ${this.payload.rustToJS("value", scope)}, None => Ok(bindgen::JsValue::${none}) }`;
  }
}

/** Not a type of its own: marks an argument or member whose absence has a value. */
export class DefaultType extends Type {
  readonly payload: Type;
  readonly value: unknown;
  /** `null` also takes the default. */
  readonly onNull: boolean;
  constructor(payload: Type, value: unknown) {
    super();
    assert(!(payload instanceof DefaultType));
    if (payload instanceof OptionalType) {
      assert(payload.kind === "nullable", ".default() follows a type or .nullable");
      this.payload = payload.payload;
      this.onNull = true;
    } else {
      this.payload = payload;
      this.onNull = false;
    }
    this.value = value;
    this.payload.toCpp(value);
  }
  get idlType(): string {
    return this.payload.idlType;
  }
  get tsType(): string {
    return `${this.payload.tsType} | ${this.onNull ? "null | undefined" : "undefined"}`;
  }
  get permitsUndefined(): boolean {
    return true;
  }
  get dependencies(): readonly Type[] {
    return [this.payload];
  }
  toCpp(value: unknown): string {
    return this.payload.toCpp(value);
  }
  toRust(value: unknown, scope: RustScope): string {
    return this.payload.toRust(value, scope);
  }
  cppConvert(value: string, ctx: string, name: string): string {
    return this.payload.cppConvert(value, ctx, name);
  }
  layout(): Layout {
    return this.payload.layout();
  }
  rustExternType(scope: RustScope): string {
    return this.payload.rustExternType(scope);
  }
  rustType(scope: RustScope): string {
    return this.payload.rustType(scope);
  }
  rustFromExtern(expr: string, scope: RustScope): string {
    return this.payload.rustFromExtern(expr, scope);
  }
}

export class ArrayType extends Type {
  get rustIsCopy(): boolean {
    return false;
  }
  readonly element: Type;
  constructor(element: Type) {
    super();
    assert(!(element instanceof DefaultType));
    assert(
      !element.borrowsHeap,
      "b.bufferSource.bytes is only for an argument: it is read after everything else is converted",
    );
    this.element = element;
  }
  get idlType(): string {
    assert(!this.element.holdsJSValue, "an array argument cannot hold JS values: the GC does not scan it");
    assert(!this.element.borrowsFrame, "an array argument cannot hold borrowed views; use b.string without .utf8");
    return `::Bun::IDLArray<${this.element.idlType}>`;
  }
  get tsType(): string {
    return `(${this.element.tsType})[]`;
  }
  get dependencies(): readonly Type[] {
    return [this.element];
  }
  getHeaders(out: Set<string>): void {
    out.add("Bindgen/ExternVectorTraits.h");
    super.getHeaders(out);
  }
  toCpp(value: unknown): string {
    assert(Array.isArray(value));
    return `${this.idlType}::ImplementationType { ${value.map(item => this.element.toCpp(item)).join(", ")} }`;
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
    return element === "value" ? `${expr}.into_vec_unconverted()` : `${expr}.into_vec(|value| ${element})`;
  }
  rustResultFieldType(scope: RustScope): string {
    return `Vec<${this.element.rustResultFieldType(scope)}>`;
  }
  rustReturnType(scope: RustScope): string {
    return `impl IntoIterator<Item = ${this.element.rustReturnType(scope)}>`;
  }
  rustToJS(value: string, scope: RustScope): string {
    return `bindgen::to_js::array(heap, ${value}, |heap, value| ${this.element.rustToJS("value", scope)})`;
  }
}

// ───────────────────────────── named types ─────────────────────────────

export abstract class NamedType extends Type {
  /** The name it is exported under, and where. Set when the generator finds it among a file's exports. */
  name = "";
  origin: Origin | null = null;
  get cpp(): string {
    return `::Bun::Bindgen::Generated::${this.name}`;
  }
  getHeaders(out: Set<string>): void {
    assert(this.origin, `${this.constructor.name}: used but not exported from a .bind.ts file`);
    out.add(`Generated${this.origin.namespace}.h`);
  }
  protected path(scope: RustScope, name: string): string {
    assert(this.origin, `${this.constructor.name}: used but not exported from a .bind.ts file`);
    if (this.origin.crate !== scope.crate)
      return `${this.origin.crate}::generated_bindgen::${this.origin.rustModule}::${name}`;
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

export class EnumType extends NamedType {
  get rustIsCopy(): boolean {
    return true;
  }
  /** `spellings[i]` all parse to variant `i`; the first is the canonical one. */
  readonly spellings: readonly (readonly string[])[];
  /** Index of the first canonical spelling in `Tables::enumerationValues`. Set by the generator. */
  firstEnumerationValueIndex = -1;
  /** Reachable from a return type. Set by the generator. */
  returned = false;
  constructor(values: readonly (string | readonly string[])[]) {
    super();
    assert(values.length > 0, "an enumeration has values");
    this.spellings = values.map(value => (typeof value === "string" ? [value] : value));
    const all = this.spellings.flat();
    assert(new Set(all).size === all.length, "duplicate value");
    assert(new Set(this.variants).size === this.variants.length, "two values make the same identifier");
    for (const variant of this.variants) assert(/^[A-Z]/.test(variant), `${variant} is not an identifier`);
  }
  get variants(): string[] {
    return this.spellings.map(([canonical]) => pascalCase(canonical));
  }
  get idlType(): string {
    return `::WebCore::IDLEnumeration<${this.cpp}>`;
  }
  get tsType(): string {
    return this.spellings
      .flat()
      .map(value => JSON.stringify(value))
      .join(" | ");
  }
  toCpp(value: unknown): string {
    const index = this.spellings.findIndex(spellings => spellings.includes(value as string));
    assert(index >= 0, `${util.inspect(value)} is not a value of ${this.name}`);
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
  /** Name of the C++ field and, in snake_case, of the Rust one. Defaults to the JS name. */
  internalName?: string;
  /** Other JS names, tried in order while the value is `undefined`. */
  altNames?: readonly string[];
}

export class Member {
  readonly names: readonly string[];
  readonly internalName: string;
  readonly type: Type;
  constructor(name: string, spec: Type | MemberOptions) {
    const options: MemberOptions = spec instanceof Type ? { type: spec } : spec;
    this.names = [name, ...(options.altNames ?? [])];
    for (const name of this.names)
      assert(/^[A-Za-z_$][\w$]*$/.test(name), `${name}: a member is named by an identifier`);
    this.internalName = options.internalName ?? name;
    this.type = options.type;
  }
  get name(): string {
    return this.names[0];
  }
  get rustName(): string {
    return rustIdent(snakeCase(this.internalName));
  }
}

export interface DictionaryOptions {
  /** What error messages call it. Defaults to its name. */
  userFacingName?: string;
  /** Also generate `Name::from_js`, for Rust that holds a JS value and no typed signature. */
  fromJS?: boolean;
  /** An array is read like any other object, not refused. */
  allowArray?: boolean;
  /** A value whose `typeof` is not "object" gives every member its default: Node's `if (typeof options !== "object") options = null`. */
  allowNonObject?: boolean;
}

export class DictionaryType extends NamedType {
  readonly options: DictionaryOptions;
  readonly members: readonly Member[];
  /** Index of the first member name in `Tables::memberNames`. Set by the generator. */
  firstMemberNameIndex = -1;
  /** Index in `Tables::objectStructures`. Set by the generator. */
  structureIndex = -1;
  /** Reachable from an argument or `fromJS` / from a return type. Set by the generator. */
  accepted = false;
  returned = false;
  constructor(members: Record<string, Type | MemberOptions>, options: DictionaryOptions = {}) {
    super();
    this.options = options;
    this.members = Object.entries(members).map(([name, spec]) => new Member(name, spec));
    assert(this.members.length > 0, "a dictionary has members");
    assert(!this.allowNonObject || this.hasDefault, "allowNonObject: every member must be optional or have a default");
    assert(
      !this.borrowsHeap,
      "b.bufferSource.bytes is only for an argument: it is read after everything else is converted",
    );
    assert(!this.fromJS || !this.borrowsFrame, "from_js outlives the frame b.string.utf8 borrows from");
  }
  get userFacingName(): string {
    return this.options.userFacingName ?? this.name;
  }
  get fromJS(): boolean {
    return !!this.options.fromJS;
  }
  get allowArray(): boolean {
    return !!this.options.allowArray;
  }
  get allowNonObject(): boolean {
    return !!this.options.allowNonObject;
  }
  get idlType(): string {
    return `::WebCore::IDLDictionary<${this.cpp}>`;
  }
  get dependencies(): readonly Type[] {
    return this.members.map(member => member.type);
  }
  /** Every JS name read, in order. */
  get names(): string[] {
    return this.members.flatMap(member => member.names);
  }
  toCpp(value: unknown): string {
    assert(typeof value === "object" && value !== null);
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
      else assert(member.type.permitsUndefined, `missing key: ${member.name}`);
      return `.${member.internalName} = ${member.type.toCpp(field)}`;
    });
    return `${this.cpp} { ${fields.join(", ")} }`;
  }
  /** Every member can be left out. */
  get hasDefault(): boolean {
    return this.members.every(member => member.type.permitsUndefined);
  }
  toRust(value: unknown, scope: RustScope): string {
    const given = value as Record<string, unknown>;
    const fields = this.members
      .filter(member => Object.hasOwn(given, member.name))
      .map(member => `${member.rustName}: ${member.type.toRust(given[member.name], scope)}, `);
    return `${this.path(scope, this.name)} { ${fields.join("")}..Default::default() }`;
  }
  layout(): Layout {
    return structLayout(this.members.map(member => member.type.layout()));
  }
  rustExternType(scope: RustScope): string {
    return this.path(scope, `Extern${this.name}`);
  }
  rustFromExtern(expr: string, scope: RustScope): string {
    return `${this.path(scope, this.name)}::from_extern(&${expr})`;
  }
  rustToJS(value: string, scope: RustScope): string {
    return `${value}.to_js(heap)`;
  }
}

/** Alternatives are tried in order; the first whose conversion accepts the value wins. */
export class UnionType extends NamedType {
  readonly alternatives: readonly { name: string; variant: string; type: Type }[];
  constructor(alternatives: Record<string, Type>) {
    super();
    this.alternatives = Object.entries(alternatives).map(([name, type]) => {
      assert(!(type instanceof DefaultType));
      return { name, variant: pascalCase(name), type };
    });
    assert(this.alternatives.length > 0 && this.alternatives.length <= 16, "1 to 16 alternatives (Bindgen/Macros.h)");
    assert(
      !this.borrowsHeap,
      "b.bufferSource.bytes is only for an argument: it is read after everything else is converted",
    );
  }
  get idlType(): string {
    return `::Bun::IDLOrderedUnion<${this.alternatives.map(a => a.type.idlType).join(", ")}>`;
  }
  get tsType(): string {
    return this.alternatives.map(a => a.type.tsType).join(" | ");
  }
  get permitsUndefined(): boolean {
    return this.alternatives.some(a => a.type.permitsUndefined);
  }
  get dependencies(): readonly Type[] {
    return this.alternatives.map(a => a.type);
  }
  toCpp(value: unknown): string {
    const unit = this.alternatives.find(a => a.type instanceof UnitType && a.type.tsType === String(value));
    assert(unit, `${this.name}: only null or undefined can be a default`);
    return `${this.idlType}::ImplementationType { ${unit.type.toCpp(value)} }`;
  }
  toRust(value: unknown, scope: RustScope): string {
    const unit = this.alternatives.find(
      a => a.type instanceof UnitType && (value === undefined || a.type.tsType === String(value)),
    );
    assert(unit, `${this.name}: only null or undefined can be a default`);
    return `${this.path(scope, this.name)}::${unit.variant}`;
  }
  layout(): Layout {
    return variantLayout(this.alternatives.map(a => a.type.layout()));
  }
  rustExternType(scope: RustScope): string {
    return this.path(scope, `Extern${this.name}`);
  }
  rustFromExtern(expr: string, scope: RustScope): string {
    return `${this.path(scope, this.name)}::from_extern(&${expr})`;
  }
}

// ───────────────────────────── functions ─────────────────────────────

/** What the Rust body is handed: nothing, `&JsHeap` (allocates JS values) or `&mut JsCall` (runs JavaScript). */
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
}

export class Signature {
  readonly args: readonly { name: string; type: Type }[];
  readonly returns: Type;
  readonly capability: Capability;
  readonly throws: boolean;
  readonly rustPath: string | undefined;
  readonly length: number | undefined;
  constructor(options: SignatureOptions) {
    this.length = options.length;
    this.args = Object.entries(options.args ?? {}).map(([name, type]) => ({ name, type }));
    this.returns = options.returns ?? new UnitType("undefined");
    this.capability = options.capability ?? "none";
    this.throws = options.throws ?? false;
    this.rustPath = options.rustPath;
    let optional = false;
    for (const { name, type } of this.args) {
      if (type.permitsUndefined) optional = true;
      else assert(!optional, `required argument ${name} follows an optional one`);
    }
    for (const { name, type } of this.args) {
      assert(
        !type.borrowsHeap || this.capability !== "js",
        `${name}: JavaScript can detach a buffer; take b.bufferSource without .bytes and use with_bytes`,
      );
    }
    assert(!(this.returns instanceof DefaultType));
    assert(!this.returns.holdsJSValue || this.capability !== "none", "returning a JS value takes a capability");
  }
  get requiredCount(): number {
    return this.args.filter(arg => !arg.type.permitsUndefined).length;
  }
}

export class FunctionDefinition {
  /** More than one: picked by argument count, most required arguments first. */
  readonly signatures: readonly Signature[];
  name = "";
  origin: Origin | null = null;
  constructor(signatures: readonly SignatureOptions[]) {
    assert(signatures.length > 0);
    this.signatures = signatures
      .map(options => new Signature(options))
      .sort((a, b) => b.requiredCount - a.requiredCount);
    const counts = this.signatures.map(signature => signature.requiredCount);
    assert(new Set(counts).size === counts.length, "overloads must differ in their number of required arguments");
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
  /** Also pass the wrapper, for its `internalFields`. `capability: "js"` always gets it. */
  passThis?: boolean;
  /** Key the function by this private builtin name (`$name` in src/js) instead of a string. */
  privateSymbol?: string;
}

export interface GetterField {
  getter: Type;
  /** Also generate a setter, which takes `&mut self` (or the wrapper, with `capability: "js"`). */
  setter?: true;
  /** Computed once per object, then kept in the wrapper. */
  cache?: true;
  capability?: Capability;
  throws?: boolean;
}

/** A function written in JavaScript: the export of this name in `src/js/builtins/<class name>.ts`. */
export interface BuiltinField {
  builtin: true;
  length: number;
}

export type Field = FunctionField | GetterField | BuiltinField;

export interface ClassOptions {
  /** Path of the Rust struct. It implements the generated `${name}Class` trait. */
  rustPath: string;
  /** Absent: JavaScript cannot construct one, and there is no constructor object. */
  construct?: Omit<SignatureOptions, "rustPath" | "returns">;
  /** Properties of the prototype. */
  proto?: Record<string, Field>;
  /** Properties of the constructor. */
  static?: Record<string, FunctionField>;
  /** JS values the object holds. The GC visits them; the wrapper gets `x_field` / `set_x_field` for each. */
  internalFields?: readonly string[];
  /** `false`: prototype properties are non-configurable. */
  configurable?: boolean;
}

export class Method extends Signature {
  readonly name: string;
  readonly rustName: string;
  readonly receiver: "ref" | "mut" | "wrapper" | "static";
  readonly passThis: boolean;
  readonly privateSymbol: string | undefined;
  constructor(name: string, options: FunctionField, isStatic = false) {
    super(options);
    this.name = name;
    this.rustName = rustIdent(snakeCase(name.replace(/^_+/, "")));
    assert(
      !(options.mutates && this.capability === "js"),
      `${name}: a method that can run JavaScript gets the wrapper, not &mut self`,
    );
    this.receiver = isStatic ? "static" : this.capability === "js" ? "wrapper" : options.mutates ? "mut" : "ref";
    this.passThis = !isStatic && this.capability !== "js" && !!options.passThis;
    this.privateSymbol = options.privateSymbol;
  }
}

export class Getter {
  readonly name: string;
  readonly type: Type;
  readonly capability: Capability;
  readonly throws: boolean;
  readonly hasSetter: boolean;
  /** Index of the internal field a cached value lives in, or -1. */
  internalFieldIndex = -1;
  constructor(name: string, options: GetterField) {
    this.name = name;
    this.type = options.getter;
    this.capability = options.capability ?? "none";
    this.throws = options.throws ?? false;
    this.hasSetter = options.setter ?? false;
    assert(!(options.cache && options.setter), `${name}: a cached getter has no setter`);
    if (options.cache) this.internalFieldIndex = 0;
  }
  get rustName(): string {
    return rustIdent(snakeCase(this.name));
  }
}

/** Stands for the class being declared, in its own signatures. */
class SelfType extends Type {
  readonly idlType = "";
  readonly tsType = "this";
  toCpp(): string {
    throw new TypeError("b.self is only for the arguments and results of a class's own members");
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

/** As an argument or a result: the wrapper, `JsWrapper<'a, T>`. */
export class ClassType extends NamedType {
  get rustIsCopy(): boolean {
    return true;
  }
  readonly rustPath: string;
  readonly construct: Signature | null;
  readonly methods: readonly Method[];
  readonly getters: readonly Getter[];
  readonly staticMethods: readonly Method[];
  readonly builtins: readonly { name: string; length: number }[];
  readonly internalFields: readonly string[];
  /** Each has an internal field of its own, after `internalFields`. */
  readonly cachedGetters: readonly Getter[];
  readonly configurable: boolean;
  /** Index in `Tables::classes`. Set by the generator. */
  classIndex = -1;
  constructor(options: ClassOptions) {
    super();
    this.rustPath = options.rustPath;
    const own = (type: Type) => (type === selfType ? this : type);
    const resolve = <T extends SignatureOptions>(signature: T): T => ({
      ...signature,
      args: Object.fromEntries(Object.entries(signature.args ?? {}).map(([name, type]) => [name, own(type)])),
      ...(signature.returns ? { returns: own(signature.returns) } : {}),
    });
    this.construct = options.construct ? new Signature(resolve(options.construct)) : null;
    const methods: Method[] = [];
    const getters: Getter[] = [];
    const builtins: { name: string; length: number }[] = [];
    for (const [name, field] of Object.entries(options.proto ?? {})) {
      if ("builtin" in field) builtins.push({ name, length: field.length });
      else if ("getter" in field) getters.push(new Getter(name, field));
      else methods.push(new Method(name, resolve(field)));
    }
    this.methods = methods;
    this.getters = getters;
    this.builtins = builtins;
    this.staticMethods = Object.entries(options.static ?? {}).map(
      ([name, field]) => new Method(name, resolve(field), true),
    );
    assert(this.construct || this.staticMethods.length === 0, "static members need a constructor object");
    this.internalFields = options.internalFields ?? [];
    this.cachedGetters = getters.filter(getter => getter.internalFieldIndex >= 0);
    this.cachedGetters.forEach((getter, index) => (getter.internalFieldIndex = this.internalFields.length + index));
    this.configurable = options.configurable ?? true;
    for (const method of this.methods) {
      assert(
        method.receiver !== "mut" ||
          !method.args.some(arg => arg.type.dependencies.includes(this) || arg.type === this),
        `${method.name}: &mut self and an argument of the same class may be the same object`,
      );
    }
  }
  get numberOfInternalFields(): number {
    return this.internalFields.length + this.cachedGetters.length;
  }
  get cpp(): string {
    return `::Bun::Bindgen::Generated::JS${this.name}`;
  }
  get idlType(): string {
    return `::Bun::Bindgen::IDLRawInterface<${this.cpp}>`;
  }
  get holdsJSValue(): boolean {
    return true;
  }
  get nullRepresentation() {
    return "pointer" as const;
  }
  /** Signatures are not dependencies: a class may mention itself. */
  get signatureTypes(): Type[] {
    return [
      ...(this.construct ? this.construct.args.map(arg => arg.type) : []),
      ...[...this.methods, ...this.staticMethods].flatMap(method => [
        ...method.args.map(arg => arg.type),
        method.returns,
      ]),
      ...this.getters.map(getter => getter.type),
    ];
  }
  toCpp(): string {
    throw new TypeError(`${this.name} cannot have a default`);
  }
  layout(): Layout {
    return { size: 8, align: 8 };
  }
  rustExternType(): string {
    return "*mut core::ffi::c_void";
  }
  rustType(): string {
    return `bindgen::JsWrapper<'a, ${this.rustPath}>`;
  }
  rustFromExtern(expr: string): string {
    return `bindgen::JsWrapper::<${this.rustPath}>::from_extern(core::ptr::NonNull::new_unchecked(${expr}))`;
  }
  rustToJS(value: string): string {
    return `bindgen::to_js::any(heap, ${value}.as_value())`;
  }
}

export class ModuleDefinition {
  /** Rust path the file's functions live under, e.g. `crate::node::node_os`. */
  readonly rustPath: string;
  constructor(options: { rustPath: string }) {
    this.rustPath = options.rustPath;
  }
}
