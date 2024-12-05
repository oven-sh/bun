import { dictionaryImpl, oneOfImpl, registerFunction, TypeImpl, TypeKind } from "./bindgen-lib-internal";

export type Type<T, Optional extends boolean | null = null> = {
  /**
   * Optional means the value may be omitted from a parameter definition.
   * Parameters are required by default.
   */
  optional: Type<T | undefined, true>;
  /**
   * When this is used as a dictionary value, this makes that parameter
   * required. Dictionary entries are optional by default.
   */
  required: Type<Exclude<T, undefined>, false>;

  /**
   * Nullable means the value may be `null`
   */
  nullable: Type<T | undefined, Optional>;

  /** Implies `optional`, this sets a default value if omitted */
  default(def: T): Type<T, true>;
};

function builtinType<T>(id: TypeKind): Type<T> {
  return new TypeImpl(id, undefined, {});
}

/** Contains all primitive types provided by the bindings generator */
export namespace t {
  /**
   * Can only be used as an argument type.
   * Tells the code generator to pass `*JSC.JSGlobalObject` as a parameter
   */
  export const globalObject = builtinType<never>("globalObject");
  /**
   * Can only be used as an argument type.
   * Tells the code generator to pass `*JSC.VirtualMachine` as a parameter
   */
  export const zigVirtualMachine = builtinType<never>("zigVirtualMachine");

  export const any = builtinType<unknown>("any");
  export const undefined = builtinType<undefined>("undefined");
  export const boolean = builtinType<boolean>("boolean");

  /** Any valid JavaScript number, does not cover BigInt */
  export const f64 = builtinType<number>("f64");
  export const usize = builtinType<number>("usize");

  /*
   * The USVString type corresponds to scalar value strings. Depending on the
   * context, these can be treated as sequences of code units or scalar values.
   */
  export const USVString = builtinType<string>("USVString");
  export const ByteString = builtinType<string>("ByteString");
  export const DOMString = builtinType<string>("DOMString");
  /**
   * DOMString but encoded as `[]const u8`
   */
  export const UTF8String = builtinType<string>("UTF8String");

  /** Throw on conversion failure */
  export const strictBoolean = builtinType<boolean>("strictBoolean");

  /** An array or iterable type of T */
  export function sequence<T>(itemType: Type<T>): Type<Iterable<T>> {
    return new TypeImpl("sequence", {
      element: itemType as TypeImpl,
      repr: "slice",
    });
  }

  /** Object with arbitrary keys but a specific value type */
  export function record<V>(valueType: Type<V>): Type<Record<string, V>> {
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

  export const BufferSource = builtinType<BufferSource>("BufferSource");
  export const Blob = builtinType<Blob>("Blob");
  export const FormData = builtinType<FormData>("FormData");
  export const URLSearchParams = builtinType<URLSearchParams>("URLSearchParams");
  export const ReadableStream = builtinType<ReadableStream>("ReadableStream");
  export const AbortSignal = builtinType<AbortSignal>("AbortSignal");

  export function oneOf<T extends Type<any>[]>(
    ...types: T
  ): Type<
    {
      [K in keyof T]: T[K] extends Type<infer U> ? U : never;
    }[number]
  > {
    return oneOfImpl(types as unknown[] as TypeImpl[]);
  }

  export function dictionary<R extends Record<string, Type<any>>>(
    fields: R,
  ): Type<{
    [K in keyof R]?: R[K] extends Type<infer T> ? T : never;
  }> {
    return dictionaryImpl(fields as Record<string, any>);
  }

  export function zigEnum(file: string, impl: string): Type<string> {
    return new TypeImpl("zigEnum", { file, impl });
  }

  export function stringEnum<T extends string[]>(
    ...values: T
  ): Type<
    {
      [K in keyof T]: K;
    }[number]
  > {
    return new TypeImpl("stringEnum", values);
  }
}

type FuncOptions = FuncMetadata &
  (
    | {
        variants: FuncVariant[];
      }
    | FuncVariant
  );

interface FuncMetadata {
  name: string;
  /** 
   * TODO:
   * Automatically generate code to expose this function on a well-known object
   */
  exposedOn?: ExposedOn;
}

type ExposedOn = "JSGlobalObject" | "BunObject";

interface FuncVariant {
  /** Ordered record */
  args: Record<string, Type<any>>;
  ret: Type<any>;
}

export function fn(opts: FuncOptions) {
  return registerFunction(opts);
}
