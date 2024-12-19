// This is the public API for `bind.ts` files
// It is aliased as `import {} from 'bindgen'`
import {
  type TypeKind,
  isType,
  dictionaryImpl,
  oneOfImpl,
  registerFunction,
  TypeImpl,
  isFunc,
  snapshotCallerLocation,
} from "./bindgen-lib-internal";
import assert from "assert";

/** A type definition for argument parsing. See `bindgen.md` for usage details. */
export type Type<
  /** T = JavaScript type that the Type represents */
  T,
  /** K = "kind" a string pertaining to the `t.<K>` that created this type. affects method listing */
  K extends TypeKind = TypeKind,
  /** F = "flags" defining if the value is optional. null = not set, false = required, true = optional. */
  F extends TypeFlag = null,
> = F extends null
  ? Props<T, K>
  : F extends true
    ? {
        [isType]: true | [T, K, F];
        /**
         * By default, optional types can be `null` or `undefined`. A non-null
         * optional only accepts `undefined` as the "none" variant.
         */
        nonNull: Type<T, K, "opt-nonnull">;
      }
    : { [isType]: true | [T, K, F] };

type TypeFlag = boolean | "opt-nonnull" | null;

interface BaseTypeProps<T, K extends TypeKind> {
  [isType]: true | [T, K];
  /**
   * Optional means the value may be omitted from a parameter definition.
   * Parameters are required by default.
   */
  optional: Type<T | undefined, K, true>;
  /**
   * When this is used as a dictionary value, this makes that parameter
   * required. Dictionary entries are optional by default.
   */
  required: Type<Exclude<T, undefined>, K, false>;

  /** Implies `optional`, this sets a default value if omitted */
  default(def: T): Type<T, K, true>;
}

interface NumericTypeProps<T, K extends TypeKind> extends BaseTypeProps<T, K> {
  /**
   * Applies [Clamp] semantics
   * https://webidl.spec.whatwg.org/#Clamp
   * If a custom numeric range is provided, it will be used instead of the built-in clamp rules.
   */
  clamp(min?: T, max?: T): Type<T, K>;
  /**
   * Applies [EnforceRange] semantics
   * https://webidl.spec.whatwg.org/#EnforceRange
   * If a custom numeric range is provided, it will be used instead of the built-in enforce rules.
   */
  enforceRange(min?: T, max?: T): Type<T, K>;

  /**
   * Equivalent to calling Node.js' `validateInteger(val, prop, min, max)`
   */
  validateInteger(min?: T, max?: T): Type<T, K>;
}

interface I32TypeProps extends NumericTypeProps<number, "i32"> {
  /**
   * Equivalent to calling Node.js' `validateInt32(val, prop, min, max)`
   */
  validateInt32(min?: number, max?: number): Type<number, "i32">;
}

interface U32TypeProps extends NumericTypeProps<number, "u32"> {
  /**
   * Equivalent to calling Node.js' `validateUint32(val, prop, min, max)`
   */
  validateUint32(min?: number, max?: number): Type<number, "u32">;
}

interface F64TypeProps extends NumericTypeProps<number, "f64"> {
  /**
   * Throws an error if the input is non-finite (NaN, ±Infinity)
   */
  finite: Type<number, "f64">;
  /**
   * Equivalent to calling Node.js' `validateNumber(val, prop, min, max)`
   */
  validateNumber(min?: number, max?: number): Type<number, "f64">;
}

// If an entry does not exist, then `BaseTypeProps` is assumed.
// T = JavaScript type that the Type represents
interface TypePropsMap<T> {
  // Integer types are always numbers, so T is not passed
  ["u8"]: NumericTypeProps<number, "u8">;
  ["i8"]: NumericTypeProps<number, "i8">;
  ["u16"]: NumericTypeProps<number, "u16">;
  ["i16"]: NumericTypeProps<number, "i16">;
  ["u32"]: U32TypeProps;
  ["i32"]: I32TypeProps;
  ["u64"]: NumericTypeProps<number, "u64">;
  ["i64"]: NumericTypeProps<number, "i64">;
  // F64 is always a number, so T is not passed.
  ["f64"]: F64TypeProps;
}

type PropertyMapKeys = keyof TypePropsMap<any>;
type Props<T, K extends TypeKind> = K extends PropertyMapKeys ? TypePropsMap<T>[K] : BaseTypeProps<T, K>;

export type AcceptedDictionaryTypeKind = Exclude<TypeKind, "globalObject" | "zigVirtualMachine">;

const kTypes = [
  "string",
  "function",
  "number",
  "object",
  // Accept 'Function' and 'Object' as alternative to the lower cased version.
  "Function",
  "Object",
  "boolean",
  "bigint",
  "symbol",
];
const classRegExp = /^[A-Z][a-zA-Z0-9]*$/;

export function formatList(array, type = "and") {
  switch (array.length) {
    case 0:
      return "";
    case 1:
      return `${array[0]}`;
    case 2:
      return `${array[0]} ${type} ${array[1]}`;
    case 3:
      return `${array[0]}, ${array[1]}, ${type} ${array[2]}`;
    default:
      return `${array.slice(0, -1).join(", ")}, ${type} ${array[array.length - 1]}`;
  }
}

/**
 * Examples:
 * - ["string", "number"] -> "a string or a number"
 */
export function nodeInvalidArgTypeMessage(expected: string[]) {
  // This function is ported from the Node.js code that generates argument error messages.
  let msg = "";

  const types: string[] = [];
  const instances: string[] = [];
  const other: string[] = [];

  for (const value of expected) {
    assert(typeof value === "string", "All expected entries have to be of type string");
    if (kTypes.includes(value)) {
      types.push(value.toLowerCase());
    } else if (classRegExp.exec(value) !== null) {
      instances.push(value);
    } else {
      assert(value !== "object", 'The value "object" should be written as "Object"');
      other.push(value);
    }
  }

  // Special handle `object` in case other instances are allowed to outline
  // the differences between each other.
  if (instances.length > 0) {
    const pos = types.indexOf("object");
    if (pos !== -1) {
      types.splice(pos, 1);
      instances.push("Object");
    }
  }

  if (types.length > 0) {
    msg += `${types.length > 1 ? "one of type" : "of type"} ${formatList(types, "or")}`;
    if (instances.length > 0 || other.length > 0) msg += " or ";
  }

  if (instances.length > 0) {
    msg += `an instance of ${formatList(instances, "or")}`;
    if (other.length > 0) msg += " or ";
  }

  if (other.length > 0) {
    if (other.length > 1) {
      msg += `one of ${formatList(other, "or")}`;
    } else {
      if (other[0].toLowerCase() !== other[0]) msg += "an ";
      msg += `${other[0]}`;
    }
  }

  return msg;
}

function builtinType<T>() {
  return <K extends TypeKind>(kind: K) => new TypeImpl(kind, undefined as any, {}) as Type<T, any> as Type<T, K>;
}

/** Contains all primitive types provided by the bindings generator */
export namespace t {
  /**
   * Can only be used as an argument type.
   * Tells the code generator to pass `*JSC.JSGlobalObject` as a parameter
   */
  export const globalObject = builtinType<never>()("globalObject");
  /**
   * Can only be used as an argument type.
   * Tells the code generator to pass `*JSC.VirtualMachine` as a parameter
   */
  export const zigVirtualMachine = builtinType<never>()("zigVirtualMachine");

  /**
   * Provides the raw JSValue from the JavaScriptCore API. Avoid using this if
   * possible. This indicates the bindings generator is incapable of processing
   * your use case.
   */
  export const any = builtinType<unknown>()("any");
  /**
   * Can only be used as an argument type.
   * Tells the code generator to pass `*JSC.CallFrame` as a parameter
   * Avoid this at all costs. This indicates the bindings generator is serverely
   * incapable of processing your use case.
   */
  export const callFrame = builtinType<never>()("callFrame");

  /** Void function type */
  export const undefined = builtinType<undefined>()("undefined");
  /** Does not throw on parse. Equivalent to `!!value` */
  export const boolean = builtinType<boolean>()("boolean");
  /** Throws if the value is not a boolean. */
  export const strictBoolean = builtinType<boolean>()("strictBoolean");

  /**
   * Equivalent to IDL's `unrestricted double`, allowing NaN and Infinity.
   * To restrict to finite values, use `f64.finite`.
   */
  export const f64 = builtinType<number>()("f64");

  export const u8 = builtinType<number>()("u8");
  export const u16 = builtinType<number>()("u16");
  export const u32 = builtinType<number>()("u32");
  export const u64 = builtinType<number>()("u64");
  export const i8 = builtinType<number>()("i8");
  export const i16 = builtinType<number>()("i16");
  export const i32 = builtinType<number>()("i32");
  export const i64 = builtinType<number>()("i64");
  export const usize = builtinType<number>()("usize");

  /**
   * The DOMString type corresponds to strings.
   *
   * **Note**: A DOMString value might include unmatched surrogate code points.
   * Use USVString if this is not desirable.
   *
   * https://webidl.spec.whatwg.org/#idl-DOMString
   */
  export const DOMString = builtinType<string>()("DOMString");
  /*
   * The USVString type corresponds to scalar value strings. Depending on the
   * context, these can be treated as sequences of code units or scalar values.
   *
   * Specifications should only use USVString for APIs that perform text
   * processing and need a string of scalar values to operate on. Most APIs that
   * use strings should instead be using DOMString, which does not make any
   * interpretations of the code units in the string. When in doubt, use
   * DOMString
   *
   * https://webidl.spec.whatwg.org/#idl-USVString
   */
  export const USVString = builtinType<string>()("USVString");
  /**
   * The ByteString type corresponds to byte sequences.
   *
   * WARNING: Specifications should only use ByteString for interfacing with protocols
   * that use bytes and strings interchangeably, such as HTTP. In general,
   * strings should be represented with DOMString values, even if it is expected
   * that values of the string will always be in ASCII or some 8-bit character
   * encoding. Sequences or frozen arrays with octet or byte elements,
   * Uint8Array, or Int8Array should be used for holding 8-bit data rather than
   * ByteString.
   *
   * https://webidl.spec.whatwg.org/#idl-ByteString
   */
  export const ByteString = builtinType<string>()("ByteString");
  /**
   * DOMString but encoded as `bun.String`. Prefer using `DOMString` instead.
   */
  export const BunString = builtinType<string>()("BunString");
  /**
   * DOMString but encoded as `[]const u8`. Prefer using `DOMString` instead.
   */
  export const UTF8String = builtinType<string>()("UTF8String");

  export function customZig<T>(customZigOption: CustomZig) {
    return new TypeImpl("customZig", customZigOption);
  }

  export function customCpp<T>(customCppOption: CustomCpp) {
    return new TypeImpl("customCpp", customCppOption);
  }

  /** An array or iterable type of T */
  export function sequence<T>(itemType: Type<T>): Type<Iterable<T>, "sequence"> {
    return new TypeImpl("sequence", {
      element: itemType as TypeImpl,
      repr: "slice",
    });
  }

  /** Object with arbitrary keys but a specific value type */
  export function record<V>(valueType: Type<V>): Type<Record<string, V>, "record"> {
    return new TypeImpl("record", {
      value: valueType as TypeImpl,
      repr: "kv-slices",
    });
  }

  /**
   * Reference a type by string name instead of by object reference.  This is
   * required in some siutations like `Request` which can take an existing
   * request object in as itself.
   */
  export function ref<T>(name: string): Type<T> {
    return new TypeImpl("ref", name);
  }

  /**
   * Reference an external class type that is not defined with `bindgen`,
   * from either WebCore, JavaScriptCore, or Bun.
   */
  export function externalClass<T>(externalClass: ExternalClass): Type<T> {
    return new TypeImpl("externalClass", externalClass);
  }

  export function oneOf<T extends Type<any>[]>(
    ...types: T
  ): Type<
    {
      [K in keyof T]: T[K] extends Type<infer U> ? U : never;
    }[number],
    "oneOf"
  > {
    return oneOfImpl(types as unknown[] as TypeImpl[]);
  }

  export function dictionary<R extends Record<string, Type<any, AcceptedDictionaryTypeKind, true | null>>>(
    fields: R,
  ): Type<
    {
      [K in keyof R]?: R[K] extends Type<infer T, any, any> ? T : never;
    },
    "dictionary"
  > {
    return dictionaryImpl(fields as Record<string, any>);
  }

  /** Create an enum from a list of strings. */
  export function stringEnum<T extends string[]>(
    ...values: T
  ): Type<
    {
      [K in keyof T]: K;
    }[number],
    "stringEnum"
  > {
    return new TypeImpl("stringEnum", values.sort());
  }

  /**
   * Equivalent to `stringEnum`, but using an enum sourced from the given Zig
   * file. Use this to get an enum type that can have functions added.
   */
  export function zigEnum(file: string, impl: string): Type<string, "zigEnum"> {
    return new TypeImpl("zigEnum", { file, impl, snapshot: snapshotCallerLocation() });
  }

  /**
   * Must be the last argument. Collects zero or more arguments
   * `t.rest(t.any)` passes `[]const JSValue` without allocating.
   */
  export function rest(...types: Type<any>[]): Type<any, "rest"> {
    return new TypeImpl("rest", types as any);
  }

  // Compound types built off of `t.customZig`

  /**
   * Anything that can be interpreted as a byte array.
   */
  export const StringOrBuffer = customZig<string | Buffer | ArrayBuffer | NodeJS.TypedArray | DataView>({
    type: "JSC.Node.StringOrBuffer",
    fromJSFunction: "JSC.Node.StringOrBuffer.fromJS",
    fromJSArgs: ["global", "allocator", "value"],
    fromJSReturn: "optional",
    validateFunction: "JSC.Node.StringOrBuffer.validateForBindgen",
    validateErrorDescription: nodeInvalidArgTypeMessage(["string", "Buffer", "TypedArray", "DataView"]),
    deinitMethod: "deinit",
    deinitArgs: [],
  });
  /**
   * Anything ArrayBuffer-like
   */
  export const ArrayBuffer = customCpp<Buffer | ArrayBuffer | NodeJS.TypedArray | DataView>({
    cppType: "Bun__ArrayBuffer",
    header: ["headers.h"],
    zigType: "JSC.ArrayBuffer",
    fromJSFunction: "JSC__JSValue__asArrayBuffer_",
    fromJSArgs: ["encoded-value", "global", "out"],
    validateErrorDescription: nodeInvalidArgTypeMessage(["Buffer", "TypedArray", "DataView"]),
  });
}

export interface ExternalClass {
  name: string;
  zig: string;
}

export interface CustomZig {
  /** Type name such as `bun.String`. Should start with `bun` or `JSC` */
  type: string;
  /** Fully qualified name */
  fromJSFunction: string;
  /** If the function can error */
  fromJSReturn?: "optional" | "error";
  /** Argument layout */
  fromJSArgs: CustomZigArg[];
  /**
   * Fast function to validate if value is probably valid.
   * This is used by variant selection code.
   * Must have no false negatives. False positives are ok
   * and can be caught by the actual `fromJS` function.
   */
  validateFunction?: string;
  /**
   * Error message to display if the value is not valid
   * "The {...} must be {validateErrorDescription}"
   */
  validateErrorDescription?: string;
  /** Method name, such as "deinit" */
  deinitMethod?: string;
  /** Argument layout, not including the value which is the first argument. */
  deinitArgs?: CustomZigArg[];
}

export interface CustomCpp {
  /** Additional headers to include */
  header: string | string[];
  /**
   * C++ type. If a Zig type name is specified, it is assumed
   * that the C++ type is compatible with the C ABI
   */
  cppType: string;
  /** Type name such as `bun.String`. Should start with `bun` or `JSC` */
  zigType?: string;
  /** Fully qualified name */
  fromJSFunction: string;
  /** If the function can error */
  fromJSReturn?: "optional" | "error";
  /** Argument layout */
  fromJSArgs: CustomCppArg[];
  /**
   * Error message to display if the value is not valid
   * "The {...} must be {validateErrorDescription}"
   */
  validateErrorDescription?: string;
}

export type CustomZigArg = "global" | "value" | "allocator" | { text: string };
export type CustomCppArg = "global" | "value" | "encoded-value" | "out" | { text: string };

export type FnOptions = FuncMetadata &
  (
    | {
        variants: FuncVariant[];
      }
    | FuncVariant
  );

export interface FuncMetadata {
  /**
   * In functions that can emit errors, this name is used. When used for a generated
   * class, this is automatically filled.
   */
  className?: string;
  /**
   * The namespace where the implementation is, by default it's in the root.
   */
  implNamespace?: string;
  // /**
  //  * TODO:
  //  * Automatically generate code to expose this function on a well-known object
  //  */
  // exposedOn?: ExposedOn;
}

export type FuncReference = { [isFunc]: true };

export type ExposedOn = "JSGlobalObject" | "BunObject";

export interface FuncVariant {
  /** Ordered record. Cannot include ".required" types since required is the default. */
  args: Record<string, Type<any, any, true | null>>;
  ret: Type<any>;
}

export function Fn(opts: FnOptions) {
  return registerFunction(opts) as FuncReference;
}

// export function getterReadonly<T>(returnType: Type<T>) {
//   return registerAttribute({ type: returnType, readonly: true });
// }

// export function getterSetter<T>(returnType: Type<T>) {
//   return registerAttribute({ type: returnType, readonly: true });
// }
export const fn = Fn;

// export interface ClassOptions {
//   /** Name of the class */
//   impl?: string;
//   methods: Record<string, FuncReference>;
//   properties: Record<string, Type<any>>;
// }

// export function Class(opts: ClassOptions) {}
