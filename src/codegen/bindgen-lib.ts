// What a `.bind.ts` file imports as `b`: docs/project/bindgen.mdx

import {
  ArrayType,
  BoolType,
  BufferSourceType,
  type BytesOptions,
  ByteSpanType,
  BytesType,
  type CellOptions,
  CellType,
  type ClassOptions,
  ClassType,
  ConversionDefinition,
  type DeferredDictionaryOptions,
  DeferredDictionaryType,
  type DictionaryOptions,
  DictionaryType,
  DoubleType,
  EnumerationType,
  type EnumerationValues,
  FunctionDefinition,
  type FunctionOptions,
  integers,
  kindsOfCell,
  type MemberOptions,
  ModuleDefinition,
  NamespaceDefinition,
  type NamespaceOptions,
  NativePromiseContextType,
  PromisePtrType,
  RecordResultType,
  RefType,
  RestType,
  type SignatureOptions,
  StringType,
  type Type,
  type UnionOptions,
  UnionType,
  UnitType,
  type ValueOptions,
  type WrappedOptions,
  WrappedType,
} from "./bindgen-lib-internal.ts";

export type { Capability, SignatureOptions, Type } from "./bindgen-lib-internal.ts";
export { null_ as null, undefined_ as undefined };

/** Strict: only a boolean. `.loose` for `ToBoolean`. */
export const bool = new BoolType();

/** Strict: a number that is an integer in range. `.allowBigInt`, `.loose`, `.wrap`, `.enforceRange()`, `.validateInteger()`, `.validateIntegerRange()`, `b.i64.asIntN`. As a result, `b.u64.asBigInt`. */
export const { u8, u16, i32, u32, i64, u64, usize } = integers;

/** Strict: only a number. `.loose` for `ToNumber`, then `.allowBigInt`. As a result, `b.f64.asDate`. */
export const f64 = new DoubleType();

/** A number kept as a JS value, as a `JsLocal<'a, Number>`, for a body that stores it, reports it or has JSC convert it. */
export { jsNumberType as jsNumber } from "./bindgen-lib-internal.ts";

/** A `bun_core::String`. Strict: only a string. `.loose` for `ToString`, then `.utf8` for `&[u8]`. `.local` for the JS string itself. */
export const string = new StringType();

/** Any JS value, as a `JsLocal<'a>`, for a function that does not depend on its type: it holds it, stores it or hands it on. `.stringObjectAsString`, `.orAbsent`. As a result, `.returning()`. */
export { opaqueType as opaque } from "./bindgen-lib-internal.ts";

/** A function, or a proxy of one, as a `JsLocal<'a, Callable>`. */
export { callableType as callable } from "./bindgen-lib-internal.ts";

/** An object, as a `JsLocal<'a, JSObject>`. */
export { objectType as object } from "./bindgen-lib-internal.ts";

/** An array, as a `JsLocal<'a, JSArray>`: `b.array(T)` converts its elements. */
export { jsArrayType as jsArray } from "./bindgen-lib-internal.ts";

/** A string or a `String` object kept as a JS value, as a `JsLocal<'a, StringLike>`. Its text is `b.string.allowStringObject`. */
export { stringLikeType as stringLike } from "./bindgen-lib-internal.ts";
export { class_ as class };

/** A typed array, `DataView` or `ArrayBuffer` that is not shared, as a `JsLocal<'a, BufferSource>`. `.arrayBuffer`. */
export const bufferSource = new BufferSourceType();

/** Bytes that C++ passes to one of a class's `calledFromCpp`. */
export const byteSpan = new ByteSpanType();

/** An instance of a `JSCell` subclass, as a `JsLocal<'a, ..>` of `rustPath`: `b.cell("JSC::JSMap", "JavaScriptCore/JSMap.h", { rustPath: "bun_jsc::JSMap" })`. */
export const cell = (cpp: string, header: string, options?: CellOptions) => new CellType(cpp, header, options);

/** What an instance of a hand-written C++ wrapper class wraps, as a `&'a T` of `rustPath`: `b.wrapped("WebCore::JSDOMURL", "JSDOMURL.h", { rustPath: "bun_jsc::DOMURL", reportedAs: "URL" })`. `.shared`. */
export const wrapped = (cpp: string, header: string, options: WrappedOptions) => new WrappedType(cpp, header, options);

/** A promise, as a `JsLocal<'a, JSPromise>`. */
export const promise = cell("JSC::JSPromise", "JavaScriptCore/JSPromise.h", {
  rustPath: "bun_jsc::JSPromise",
  tsType: "Promise<any>",
});

/** A `DataView`, as a `JsLocal<'a, JSObject>`. */
export const dataView = cell("JSC::JSDataView", "JavaScriptCore/JSDataView.h", {
  rustPath: "bun_jsc::JSObject",
  tsType: "DataView",
});

/** An `AbortSignal`, as a `&'a AbortSignal`. */
export const abortSignal = wrapped("WebCore::JSAbortSignal", "JSAbortSignal.h", { rustPath: "bun_jsc::AbortSignal" });

/** A `String` object, not converted: that runs its `toString`. */
export const stringObject = cell("JSC::StringObject", "JavaScriptCore/StringObject.h", {
  rustPath: "bun_jsc::JSObject",
  reportedAs: "String",
  tsType: "String",
});
/** A BigInt kept as a JS value, as a `JsLocal<'a, JSBigInt>`. */
export const bigInt = cell("JSC::JSBigInt", "JavaScriptCore/JSBigInt.h", {
  rustPath: "bun_jsc::JSBigInt",
  reportedAs: "bigint",
  tsType: "bigint",
});
/** A symbol, as a `JsLocal<'a, Symbol>`. */
export const symbol = cell("JSC::Symbol", "JavaScriptCore/Symbol.h", {
  rustPath: "bun_jsc::bindgen::Symbol",
  reportedAs: "symbol",
  tsType: "symbol",
});

/** The bytes of a string, a buffer or a `Blob`: which of them, what becomes of anything else, and how the body holds them. */
export const bytes = (options: BytesOptions) => new BytesType(options);

/** The native `Blob` behind a JS `Blob`. */
export const blob = new RefType(
  "Bun::Bindgen::IDLBlobRef",
  "globalThis.Blob",
  "bun_jsc::webcore_types::Blob",
  "Bindgen/IDLConvertBlob.h",
  kindsOfCell("Bun::Bindgen::Generated::JSBlob"),
  null,
);

/** The context of a promise reaction that `JSValue::then` was given: a `*mut` of the type at `rustPath`. */
export const promisePtr = (rustPath: string) => new PromisePtrType(rustPath);

/** The context of a promise reaction that is a `NativePromiseContext` cell: what `take` hands back, an `Option<NonNull<..>>` of the type at `rustPath`. */
export const nativePromiseContext = (rustPath: string) => new NativePromiseContextType(rustPath);

/** `null` or `undefined`, as an alternative of a union. */
const null_ = new UnitType("null");
/** `undefined`, as an alternative of a union. */
const undefined_ = new UnitType("undefined");
/** Every value the alternatives before it do not take, as the last alternative of a union. It carries nothing. */
export const ignored = new UnitType("ignored");

export const array = (element: Type) => new ArrayType(element);

/** The last argument and every one after it: a `Rest<'a, T>`, whose elements the body converts, or for `b.opaque` and `b.string.local` a `&'a [T]`. */
export const rest = (element: Type) => new RestType(element);

/** A result only: an object with a property for each `(key, value)` the body gives. */
export const record = (value: Type) => new RecordResultType(value);

// A named type is called what it is exported as: `export const Formatter = b.enumeration([..])`.

/** An array in place of a value lists several spellings of it; the first is the one given back to JS. `{ RgbArray: "[rgb]" }` names the variants. */
export const enumeration = (values: EnumerationValues) => new EnumerationType(values);

export function dictionary(
  members: Record<string, Type | MemberOptions>,
  options: DeferredDictionaryOptions,
): DeferredDictionaryType;
export function dictionary(members: Record<string, Type | MemberOptions>, options?: DictionaryOptions): DictionaryType;
export function dictionary(
  members: Record<string, Type | MemberOptions>,
  options?: DictionaryOptions | DeferredDictionaryOptions,
) {
  return options && "deferred" in options
    ? new DeferredDictionaryType(members, options)
    : new DictionaryType(members, options);
}

/** A value goes to the first alternative, in written order, that takes its kind. */
export const union = (alternatives: Record<string, Type>, options?: UnionOptions) =>
  new UnionType(alternatives, options);

/** A JS class whose state is the Rust struct at `options.rustPath`, stored inside the wrapper object. */
const class_ = (options: ClassOptions) => new ClassType(options);

/** The class being declared, in its own signatures: a `JsWrapper<'a, Self>`. */
export { selfType as self } from "./bindgen-lib-internal.ts";

export const fn = (options: FunctionOptions) => new FunctionDefinition([options], options);

/** `export const fieldText = b.conversion(b.string.loose)`: `field_text(global, value)` converts a value that is not an argument, when the body says so. A dictionary or a union has `fromJS` for that. */
export const conversion = (type: Type) => new ConversionDefinition(type);

/** What a Rust function returns. `$bindgen` calls it. */
export const value = (options: ValueOptions) => new FunctionDefinition([options], {}, true);

/** One JS function, several signatures, told apart by the kinds of their arguments. */
export const overloads = (...signatures: FunctionOptions[]) => new FunctionDefinition(signatures, signatures[0]);

/** `export const semver = b.namespace({ satisfies: { args, returns }, .. })`: an object that holds those functions, or with `{ call: "satisfies" }` a function that does what that one does. An array is the overloads of one function. */
export const namespace = (
  functions: Record<string, SignatureOptions | readonly SignatureOptions[]>,
  options?: NamespaceOptions,
) => new NamespaceDefinition(functions, options);

/** `export default b.module({ rustPath: "crate::node::os" })`: where the file's Rust functions are. */
export const module = (options: { rustPath: string }) => new ModuleDefinition(options);
