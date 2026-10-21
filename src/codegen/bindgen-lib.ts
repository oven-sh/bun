// What a `.bind.ts` file imports as `b`: docs/project/bindgen.mdx

import {
  AnyType,
  ArrayType,
  BoolType,
  BufferSourceType,
  type BytesOptions,
  BytesType,
  CallableType,
  type ClassOptions,
  ClassRefType,
  ClassType,
  type DictionaryOptions,
  DictionaryType,
  DoubleType,
  EnumerationType,
  FunctionDefinition,
  integers,
  type MemberOptions,
  ModuleDefinition,
  NamespaceDefinition,
  type NamespaceOptions,
  RecordResultType,
  RefType,
  type SignatureOptions,
  StringType,
  type Type,
  UnionType,
  UnitType,
} from "./bindgen-lib-internal.ts";

export type { Capability, Type } from "./bindgen-lib-internal.ts";
export { null_ as null };

/** Strict: only a boolean. `.loose` for `ToBoolean`. */
export const bool = new BoolType();

/** Strict: a number that is an integer in range. `.allowBigInt`, `.loose`, `.wrap`, `.enforceRange()`, `.validateInteger()`. As a result, `b.u64.asBigInt`. */
export const { u8, u16, i32, u32, u64, usize } = integers;

/** Strict: only a number. `.loose` for `ToNumber`, then `.allowBigInt`. As a result, `b.f64.asDate`. */
export const f64 = new DoubleType();

/** A `bun_core::String`. Strict: only a string. `.loose` for `ToString`, then `.utf8` for `&[u8]`. As a result, `b.string.local`. */
export const string = new StringType();

/** The JS value itself, as a `JsLocal<'a>`. */
export const any = new AnyType();

/** A function, or a proxy of one, as a `JsLocal<'a, Callable>`. */
export const callable = new CallableType();

/** A typed array, `DataView` or `ArrayBuffer` that is not shared, as a `JsLocal<'a, BufferSource>`. `.arrayBuffer`. */
export const bufferSource = new BufferSourceType();

/** The bytes of a string, a buffer or a `Blob`: which of them, what becomes of anything else, and how the body holds them. */
export const bytes = (options: BytesOptions) => new BytesType(options);

/** The native `Blob` behind a JS `Blob`. */
export const blob = new RefType(
  "Bun::Bindgen::IDLBlobRef",
  "Blob",
  "bun_jsc::webcore_types::Blob",
  "Bindgen/IDLConvertBlob.h",
  [{ cpp: "WebCore::JSBlob" }],
  "detached Blobs",
);

/** An instance of the class `name` of a `.classes.ts` file, as a `&'a` of the Rust struct it wraps. */
export const classRef = (name: string) => new ClassRefType(name);

const null_ = new UnitType("null");

export const array = (element: Type) => new ArrayType(element);

/** A result only: an object with a property for each `(key, value)` the body gives. */
export const record = (value: Type) => new RecordResultType(value);

// A named type is called what it is exported as: `export const Formatter = b.enumeration([..])`.

/** An array in place of a value lists several spellings of it; the first is the one given back to JS. */
export const enumeration = (values: readonly (string | readonly string[])[]) => new EnumerationType(values);

export const dictionary = (members: Record<string, Type | MemberOptions>, options?: DictionaryOptions) =>
  new DictionaryType(members, options);

/** A value goes to the first alternative, in written order, that takes its kind. */
export const union = (alternatives: Record<string, Type>) => new UnionType(alternatives);

/** A JS class whose state is the Rust struct at `options.rustPath`, stored inside the wrapper object. */
const class_ = (options: ClassOptions) => new ClassType(options);
export { class_ as class };

/** The class being declared, in its own signatures: a `JsWrapper<'a, Self>`. */
export { selfType as self } from "./bindgen-lib-internal.ts";

export const fn = (signature: SignatureOptions) => new FunctionDefinition([signature]);

/** One JS function, several signatures, told apart by the kinds of their arguments. */
export const overloads = (...signatures: SignatureOptions[]) => new FunctionDefinition(signatures);

/** `export const semver = b.namespace({ satisfies: { args, returns }, .. })`: an object that holds those functions, or with `{ call: "satisfies" }` a function that does what that one does. */
export const namespace = (functions: Record<string, SignatureOptions>, options?: NamespaceOptions) =>
  new NamespaceDefinition(functions, options);

/** `export default b.module({ rustPath: "crate::node::os" })`: where the file's Rust functions are. */
export const module = (options: { rustPath: string }) => new ModuleDefinition(options);
