// What a `.bind.ts` file imports as `b`: docs/project/bindgen.mdx

import {
  AnyType,
  ArrayType,
  BoolType,
  BufferSourceType,
  type BytesOptions,
  ByteSpanType,
  BytesType,
  CellClass,
  type ClassOptions,
  ClassType,
  defineFamily,
  defineInterface,
  defineMixin,
  definePartial,
  type DictionaryOptions,
  DictionaryType,
  DoubleType,
  EnumerationType,
  type EnumerationValues,
  FiniteDoubleType,
  FloatType,
  FunctionDefinition,
  type FunctionOptions,
  includeMixin,
  integers,
  interfaceNamed,
  ListType,
  type MemberOptions,
  ModuleDefinition,
  type ModuleOptions,
  NamespaceDefinition,
  type NamespaceOptions,
  NativeInstanceType,
  NativePromiseContextType,
  PromisePtrType,
  RecordResultType,
  RefType,
  RestType,
  SequenceType,
  type SignatureOptions,
  StringType,
  type Type,
  TypedArrayType,
  UnionType,
  UnitType,
  type ValueOptions,
  WebStringType,
} from "./bindgen-lib-internal.ts";

export type { Capability, Type } from "./bindgen-lib-internal.ts";
export { null_ as null, undefined_ as undefined };

/** Strict: only a boolean. `.loose` for `ToBoolean`. */
export const bool = new BoolType();

/** Strict: a number that is an integer in range. `.allowBigInt`, `.loose`, `.wrap`, `.enforceRange()`, `.validateInteger()`. As a result, `b.u64.asBigInt`. */
export const { i8, u8, i16, u16, i32, u32, i64, u64, usize } = integers;

/** Strict: only a number. `.loose` for `ToNumber`, then `.allowBigInt`. As a result, `b.f64.asDate`. */
export const f64 = new DoubleType();

/** WebIDL's `double`, `float` and `unrestricted float`. `unrestricted double` is `b.f64.loose`. */
export const double = new FiniteDoubleType();
export const float = new FloatType(true);
export const unrestrictedFloat = new FloatType(false);

/** What `ToString` gives, as a `JsLocal<'a, JSString>`. `.nullToEmpty`, then `.utf8`, `.impl` or `.atom`. */
export const DOMString = new WebStringType("DOMString");
export const USVString = new WebStringType("USVString");
export const ByteString = new WebStringType("ByteString");

/** A `bun_core::String`. Strict: only a string. `.loose` for `ToString`, then `.utf8` for `&[u8]`. `.local` for the JS string itself. */
export const string = new StringType();

/** The JS value itself, as a `JsLocal<'a>`. `.stringObjectAsString`, `.orAbsent`. */
export const any = new AnyType();

/** A function, or a proxy of one, as a `JsLocal<'a, Callable>`. */
export { callableType as callable } from "./bindgen-lib-internal.ts";

/** An object, as a `JsLocal<'a, JSObject>`. */
export { objectType as object } from "./bindgen-lib-internal.ts";

/** An array, as a `JsLocal<'a, JSArray>`: `b.array(T)` converts its elements. */
export { jsArrayType as jsArray } from "./bindgen-lib-internal.ts";
export { class_ as class };

/** A typed array, `DataView` or `ArrayBuffer` that is not shared, as a `JsLocal<'a, BufferSource>`. `.arrayBuffer`. */
export const bufferSource = new BufferSourceType();

/** Bytes that C++ passes to one of a class's `calledFromCpp`. */
export const byteSpan = new ByteSpanType();

/** An internal field that holds one `JSCell` subclass: `b.cell("JSC::JSPromise", "JavaScriptCore/JSPromise.h")`. */
export const cell = (cpp: string, header: string) => new CellClass(cpp, header);

/** The bytes of a string, a buffer or a `Blob`: which of them, what becomes of anything else, and how the body holds them. */
export const bytes = (options: BytesOptions) => new BytesType(options);

/** The native `Blob` behind a JS `Blob`. */
export const blob = new RefType(
  "Bun::Bindgen::IDLBlobRef",
  "globalThis.Blob",
  "bun_jsc::webcore_types::Blob",
  "Bindgen/IDLConvertBlob.h",
  [{ cpp: "Bun::Bindgen::Generated::JSBlob" }],
  null,
);

/** The context of a promise reaction that `JSValue::then` was given: a `*mut` of the type at `rustPath`. */
export const promisePtr = (rustPath: string) => new PromisePtrType(rustPath);

/** The context of a promise reaction that is a `NativePromiseContext` cell: what `take` hands back, an `Option<RefPtr<..>>` of the type at `rustPath`. */
export const nativePromiseContext = (rustPath: string) => new NativePromiseContextType(rustPath);

/** `null` or `undefined`, as an alternative of a union. */
const null_ = new UnitType("null");
/** `undefined`, as an alternative of a union. */
const undefined_ = new UnitType("undefined");

export const array = (element: Type) => new ArrayType(element);

/** A result only: an object with a property for each `(key, value)` the body gives. */
export const record = (value: Type) => new RecordResultType(value);

/** The last argument: it and every one after it, as a `&'a [T]`. `element` is `b.any` or `b.string.local`. */
export const rest = (element: Type) => new RestType(element);

// A named type is called what it is exported as: `export const Formatter = b.enumeration([..])`.

/** An array in place of a value lists several spellings of it; the first is the one given back to JS. `{ RgbArray: "[rgb]" }` names the variants. */
export const enumeration = (values: EnumerationValues) => new EnumerationType(values);

export const dictionary = (members: Record<string, Type | MemberOptions>, options?: DictionaryOptions) =>
  new DictionaryType(members, options);

/** A value goes to the first alternative, in written order, that takes its kind. */
export const union = (alternatives: Record<string, Type>, options?: { webidl?: boolean }) =>
  new UnionType(alternatives, options);

/** A JS class whose state is the Rust struct at `options.rustPath`, stored inside the wrapper object. */
const class_ = (options: ClassOptions) => new ClassType(options);

/** WebIDL's `sequence<T>`, as a `bindgen::JsList<'a, T>`. A function returns any `IntoIterator`. */
export const sequence = (element: Type) => new ListType(null, element);
/** The same as a `Vec<T>`, for what holds no JS value. */
export const sequenceVec = (element: Type) => new SequenceType(element);
/** WebIDL's `FrozenArray<T>`. */
export const frozenArray = (element: Type) => new ListType(null, element, true);
/** WebIDL's `record<K, V>` as an argument: a `bindgen::JsRecord<'a, K, V>`. */
export const recordOf = (key: Type, value: Type) => new ListType(key, value);
/** `"Float32Array"`, `"DataView"`, `"ArrayBuffer"`, `"ArrayBufferView"`.. as a `JsLocal<'a, TypedArray<f32>>`. */
export const typedArray = (name: ConstructorParameters<typeof TypedArrayType>[0]) => new TypedArrayType(name);

/** `b.instanceOf("AbortSignal", "WebCore::JSAbortSignal", "JSAbortSignal.h")`, as a `JsLocal<'a, JSObject>`. */
export const instanceOf = (name: string, cpp: string, header: string) => new NativeInstanceType(name, cpp, header);

/** A class with WebIDL's rules. `name` is what it is exported as. */
export { interface_ as interface };
const interface_ = defineInterface;

/** The interface that some file exports under this name. */
export const ref = interfaceNamed;

/** Members that several interfaces include. */
export const mixin = defineMixin;

/** More members of the interface `on`, from another file. */
export const partial = definePartial;

/** `Document includes Mixin;`, from another file than the one that declares the interface. */
export const include = includeMixin;

/** One getter and setter for many attributes: `Family.of(key)`. */
export const family = defineFamily;

/** The class being declared, in its own signatures: a `JsWrapper<'a, Self>`. */
export { selfType as self } from "./bindgen-lib-internal.ts";

export const fn = (options: FunctionOptions) => new FunctionDefinition([options], options);

/** What a Rust function returns. `$bindgen` calls it. */
export const value = (options: ValueOptions) => new FunctionDefinition([options], {}, true);

/** One JS function, several signatures, told apart by the kinds of their arguments. */
export const overloads = (...signatures: FunctionOptions[]) => new FunctionDefinition(signatures, signatures[0]);

/** A function, or the overloads of one, that counts its arguments as a method of an interface does. */
export const operation = (...signatures: FunctionOptions[]) =>
  new FunctionDefinition(
    signatures.map(it => ({
      requiredArguments: Object.values(it.args ?? {}).findLastIndex(type => !type.isOmittable) + 1,
      ...it,
    })),
    signatures[0],
    false,
    true,
  );

/** `export const semver = b.namespace({ satisfies: { args, returns }, .. })`: an object that holds those functions, or with `{ call: "satisfies" }` a function that does what that one does. An array is the overloads of one function. */
export const namespace = (
  functions: Record<string, SignatureOptions | readonly SignatureOptions[]>,
  options?: NamespaceOptions,
) => new NamespaceDefinition(functions, options);

/** `export default b.module({ rustPath: "crate::node::os" })`: where the file's Rust functions are. */
export const module = (options: ModuleOptions) => new ModuleDefinition(options);
