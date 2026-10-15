// What a `.bind.ts` file imports as `b`: docs/project/bindgen.mdx

import {
  AnyType,
  ArrayType,
  BoolType,
  BufferSourceType,
  type ClassOptions,
  ClassType,
  type DictionaryOptions,
  DictionaryType,
  DoubleType,
  EnumType,
  FunctionDefinition,
  integers,
  type MemberOptions,
  ModuleDefinition,
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

/** Strict: a number (or BigInt) that is an integer in range. `.loose`, `.wrap`, `.enforceRange()`, `.validateInteger()`. */
export const { u8, u16, i32, u32, u64, usize } = integers;

/** Strict: only a number. */
export const f64 = new DoubleType();

/** An owned `bun_core::String`. Strict: only a string. `.loose` for `ToString`, then `.utf8` for `&[u8]`. */
export const string = new StringType();

/** The JS value itself, as a `JsValue<'a>`. */
export const any = new AnyType();

/** A typed array, `DataView` or `ArrayBuffer` that is not shared, as a `JsValue<'a, ArrayBuffer>`. `.bytes`, `.arrayBuffer`. */
export const bufferSource = new BufferSourceType();

/** The native `Blob` behind a JS `Blob`. */
export const blob = new RefType("::Bun::IDLBlobRef", "Blob", "bun_jsc::webcore_types::Blob", "BunIDLConvertBlob.h", [
  { cpp: "::WebCore::JSBlob" },
]);

const null_ = new UnitType("null");

export const array = (element: Type) => new ArrayType(element);

// A named type is called what it is exported as: `export const Formatter = b.enumeration([..])`.

/** An array in place of a value lists several spellings of it; the first is the one given back to JS. */
export const enumeration = (values: readonly (string | readonly string[])[]) => new EnumType(values);

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

/** One JS function, several signatures, told apart by how many arguments were passed and by their kinds. */
export const overloads = (...signatures: SignatureOptions[]) => new FunctionDefinition(signatures);

/** `export default b.module({ rustPath: "crate::node::os" })`: where the file's Rust functions are. */
export const module = (options: { rustPath: string }) => new ModuleDefinition(options);
