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
      /**
       * Number of parameters accepted by the function.
       *
       * Sets [`function.length`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/length).
       */
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
      /**
       * Number of parameters accepted by the function.
       *
       * Sets [`function.length`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/length).
       */
      length?: number;
    };

export class ClassDefinition {
  /**
   * Class name.
   *
   * Used to find the proper struct and as the `.name` of the JS constructor
   * function.
   */
  name: string;
  /**
   * Class constructor is newable.
   */
  construct?: boolean;
  /**
   * Class constructor is callable. In JS, ES6 class constructors are not
   * callable.
   */
  call?: boolean;
  finalize?: boolean;
  overridesToJS?: boolean;
  /**
   * Static properties and methods.
   */
  klass: Record<string, Field>;
  /**
   * properties and methods on the prototype.
   */
  proto: Record<string, Field>;
  /**
   * Properties and methods attached to the instance itself.
   */
  own: Record<string, string>;
  values?: string[];
  /**
   * Set this to `"0b11101110"`.
   */
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

  constructor(options: Partial<ClassDefinition>) {
    this.name = options.name ?? "";
    this.klass = options.klass ?? {};
    this.proto = options.proto ?? {};
    this.own = options.own ?? {};

    Object.assign(this, options);
  }

  hasOwnProperties() {
    for (const key in this.own) {
      return true;
    }

    return false;
  }
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
    own = {},
    values = [],
    overridesToJS = false,
    estimatedSize = false,
    call = false,
    construct = false,
    structuredClone = false,
    ...rest
  } = {} as Partial<ClassDefinition>,
): Partial<ClassDefinition> {
  return new ClassDefinition({
    ...rest,
    call,
    overridesToJS,
    construct,
    estimatedSize,
    structuredClone,
    values,
    own: own || {},
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
  });
}
