interface PropertyAttribute {
  enumerable?: boolean;
  configurable?: boolean;
  /**
   * The name for a private symbol to use as the property name. The value should
   * be a private symbol from `BunBuiltinNames.h`. This will omit the property
   * from the prototype hash table, instead setting it using `putDirect()`.
   */
  privateSymbol?: string;
}

export type Field =
  | ({
      getter: string;
      cache?: true | string;
      /**
       * Allow overriding the value of the property
       */
      writable?: boolean;
      this?: boolean;
    } & PropertyAttribute)
  | { value: string }
  | ({ setter: string; this?: boolean } & PropertyAttribute)
  | ({
      accessor: { getter: string; setter: string };
      cache?: true | string;
      this?: boolean;
    } & PropertyAttribute)
  | ({
      fn: string;
      length?: number;
      passThis?: boolean;
      DOMJIT?: {
        returns: string;
        args?: [string, string] | [string, string, string] | [string] | [];
        pure?: boolean;
      };
    } & PropertyAttribute)
  | { internal: true }
  | {
      /**
       * The function is a builtin (its implementation is defined in
       * src/js/builtins/), this value is the name of the code generator
       * function: `camelCase(fileName + functionName + "CodeGenerator"`)
       */
      builtin: string;
      length?: number;
    };

export interface ClassDefinition {
  name: string;
  construct?: boolean;
  call?: boolean;
  finalize?: boolean;
  overridesToJS?: boolean;
  klass: Record<string, Field>;
  proto: Record<string, Field>;
  values?: string[];
  JSType?: string;
  noConstructor?: boolean;

  final?: boolean;

  // Do not try to track the `this` value in the constructor automatically.
  // That is a memory leak.
  wantsThis?: never;

  /**
   * Called from any thread.
   *
   * Used for GC.
   */
  estimatedSize?: boolean;
  /**
   * Used in heap snapshots.
   *
   * If true, the class will have a `memoryCost` method that returns the size of the object in bytes.
   *
   * Unlike estimatedSize, this is always called on the main thread and not used for GC.
   *
   * If none is provided, we use the struct size.
   */
  memoryCost?: boolean;
  hasPendingActivity?: boolean;
  isEventEmitter?: boolean;
  supportsObjectCreate?: boolean;

  getInternalProperties?: boolean;

  custom?: Record<string, CustomField>;

  configurable?: boolean;
  enumerable?: boolean;
  structuredClone?: boolean | { transferable: boolean; tag: number };

  callbacks?: Record<string, string>;
}

export interface CustomField {
  header?: string;
  extraHeaderIncludes?: string[];
  impl?: string;
  type?: string;
}

export function define(
  {
    klass = {},
    proto = {},
    values = [],
    overridesToJS = false,
    estimatedSize = false,
    call = false,
    construct = false,
    structuredClone = false,
    ...rest
  } = {} as ClassDefinition,
): ClassDefinition {
  return {
    ...rest,
    call,
    overridesToJS,
    construct,
    estimatedSize,
    structuredClone,
    values,
    klass: Object.fromEntries(
      Object.entries(klass)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => {
          v.DOMJIT = undefined;
          return [k, v];
        }),
    ),
    proto: Object.fromEntries(
      Object.entries(proto)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => {
          v.DOMJIT = undefined;
          return [k, v];
        }),
    ),
  };
}
