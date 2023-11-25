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
  | ({ getter: string; cache?: true | string; this?: boolean } & PropertyAttribute)
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
  klass: Record<string, Field>;
  proto: Record<string, Field>;
  values?: string[];
  /** This creates additional accessors to the "values", but from JSObject instead of from JSValues
   * (this is need for example to access the values from the getOwnPropertySlot callback) */
  valuesAccessorsFromJsObject?: boolean;
  JSType?: string;
  noConstructor?: boolean;
  estimatedSize?: boolean;
  hasPendingActivity?: boolean;
  isEventEmitter?: boolean;
  supportsObjectCreate?: boolean;

  getInternalProperties?: boolean;

  /**
   * Callback for dynamic resolution of properties of the object. Depending on the mode:
   *  - If "first": call "getOwnPropertySlot" first, and only try to resolve the object properties if it returned false.
   *  - If "last": try to resolve the object properties, and only call "getOwnPropertySlot" if that failed.
   *  - If "only": just call "getOwnPropertySlot" and don't resolve object properties
   */
  getOwnPropertySlot?: "first" | "last" | "only";
  /** Same as getOwnPropertySlot, but generated on the class constructor instead of on the class itself */
  getOwnPropertySlotStatic?: "first" | "last" | "only";

  /** Override the apply method (call the instance as function) on the class instances */
  apply?: boolean;

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
    construct,
    estimatedSize,
    structuredClone,
    values,
    klass: Object.fromEntries(Object.entries(klass).sort(([a], [b]) => a.localeCompare(b))),
    proto: Object.fromEntries(Object.entries(proto).sort(([a], [b]) => a.localeCompare(b))),
  };
}
