import type { ClassColumns, EntryColumns, SignatureColumns } from "./builtins/vocabulary.ts";

interface PropertyAttribute {
  enumerable?: boolean;
  configurable?: boolean;
  /**
   * The name for a private symbol to use as the property name. The value should
   * be a private symbol from `BunBuiltinNames.h`. This will omit the property
   * from the prototype hash table, instead setting it using `putDirect()`.
   */
  privateSymbol?: string;
  publicSymbol?: string;
  name?: string;
}

/**
 * Specifies what happens when a method is called with `this` set to a value that is not an instance
 * of the class.
 */
export const InvalidThisBehavior = {
  /**
   * Default. Throws a `TypeError`.
   */
  Throw: 0,
  /**
   * Do not call the native implementation; return `undefined`. Some Node.js methods are supposed to
   * work like this.
   */
  NoOp: 1,
} as const;
export type InvalidThisBehavior = (typeof InvalidThisBehavior)[keyof typeof InvalidThisBehavior];

/** Columns of the built-ins table for a member (src/codegen/builtins/vocabulary.ts). Read by src/codegen/builtins/collect-classes.ts. None of them changes the generated bindings. */
type TableColumns = SignatureColumns & EntryColumns;

/**
 * Code compiled with `--aot` takes the declared type of a getter or function on trust, so every declared type is either
 * proven or checked.
 */
interface DeclaredTypeStrength {
  /**
   * `true`: the native method may return any `JSValue`. The generated C++ wrapper looks at the value in every build and
   * ends the process, naming the member, if the value lies outside the declared type.
   *
   * Otherwise the Rust method's return type must prove the declared type (src/jsc/proven_return.rs), and nothing is
   * looked at when the program runs.
   */
  checkedAtRuntime?: boolean;
}

export type Field =
  | ({
      getter: string;
      cache?: true | string;
      /** Type of the value, in the grammar of `parseDeclaredType`. */
      type?: string;
      /**
       * Allow overriding the value of the property
       */
      writable?: boolean;
      this?: boolean;
      /**
       * Somebody has read the native getter down to the last function it calls: it allocates nothing in the JavaScript heap,
       * throws nothing, runs no JavaScript, walks no stack, takes no lock that a collection waits for, and changes nothing that
       * a program can see. Code compiled ahead of time enters it without a frame, so a getter of which this is not true
       * corrupts the program. Its `type` holds no cell and is proven by the return type of the Rust method.
       */
      pure?: boolean;
    } & DeclaredTypeStrength &
      PropertyAttribute &
      TableColumns)
  | { value: string }
  | ({ setter: string; this?: boolean } & PropertyAttribute)
  | ({
      fn: string;

      /**
       * Mark it as an async function in the TypeScript definition.
       *
       * Does not do anything at runtime.
       */
      async?: boolean;
      /**
       * Number of parameters accepted by the function.
       *
       * Sets [`function.length`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/length).
       */
      length?: number;
      passThis?: boolean;
      invalidThisBehavior?: InvalidThisBehavior;
      /** Result type, in the grammar of `parseDeclaredType`. */
      returns?: string;
    } & DeclaredTypeStrength &
      PropertyAttribute &
      TableColumns)
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
   * Legacy. All classes emit implementer thunks into `generated_classes.rs`;
   * this field is accepted for backward compatibility but has no effect.
   *
   * @default "rust"
   */
  lang?: "rust";
  /**
   * Fully-qualified Rust path of the native struct backing this class, e.g.
   * `crate::webcore::request::Request`. The codegen emits
   * `pub use <rustPath> as <name>;` so the `#[no_mangle]` thunks call
   * inherent methods on the real type (compile error if a method is missing).
   *
   * If unset, the codegen scans `src/runtime/**\/*.rs` for
   * `pub struct <name>` and resolves the module path from the `mod` tree
   * rooted at `src/runtime/lib.rs`. Set this explicitly only when that
   * heuristic picks the wrong file (or the struct lives in another crate).
   */
  rustPath?: string;
  /**
   * Host-fn receiver mutability for the generated Rust thunks.
   *
   * `true` emits `this: &T` and routes through the `host_fn::*_shared`
   * helpers — required for any type whose methods may re-enter JS while
   * `this` is live (R-2 noalias re-entrancy). The Rust impl must take
   * `&self` and use `Cell`/`JsCell` for any field it mutates.
   *
   * `false` (the default, legacy) emits `this: &mut T`. UB if a method
   * re-enters JS and another host-fn on the same instance runs — `&mut T`
   * carries LLVM `noalias`, so the compiler may cache `*self` fields
   * across the FFI call (proven miscompile: `NodeHTTPResponse::cork`,
   * b818e70e1c57).
   *
   * @default false
   */
  sharedThis?: boolean;
  /**
   * Class constructor is newable. Called before the JSValue corresponding to
   * the object is created. Throwing an exception prevents the object from being
   * created.
   */
  construct?: boolean;

  /**
   * Class constructor needs `this` value.
   *
   * Makes the code generator call the native constructor function **after** the
   * JSValue is instantiated. Only use this if you must, as it probably isn't
   * good for GC since it means if the constructor throws the GC will have to
   * clean up the object that never reached JS.
   */
  constructNeedsThis?: boolean;
  /**
   * Class constructor is callable. In JS, ES6 class constructors are not
   * callable.
   */
  call?: boolean;
  /**
   * The instances of this class are intended to be inside the this of a bound function.
   */
  forBind?: boolean;
  /**
   * Parent of the generated prototype object. "Error" puts Error.prototype in
   * the chain so instances satisfy `instanceof Error`. Default: Object.prototype.
   */
  prototypeBase?: "Error";
  /**
   * The JS wrapper owns the payload: when it is collected the payload is
   * handed to `fn finalize(self: Box<Self>)` (an inherent method if the type
   * has one, else `bun_jsc::JsFinalize`'s default, which drops the Box).
   * For a payload the wrapper only holds one ref on, set `refCounted` instead.
   * @todo remove this and require all classes to implement `finalize`.
   */
  finalize?: boolean;
  /**
   * The payload is intrusively refcounted (`CellRefCounted` /
   * `ThreadSafeRefCounted` / `RefCounted`) and the JS wrapper holds one ref.
   * Collection runs `fn finalize(&self)` (inherent if present — e.g. to clear
   * a `this_value` — else `bun_jsc::JsFinalizeRefCounted`'s no-op) and then drops
   * the wrapper's ref; the payload's `Drop` runs when the last ref goes.
   */
  refCounted?: boolean;
  overridesToJS?: boolean;
  /**
   * Static properties and methods.
   */
  klass: Record<string, Field>;
  /**
   * properties and methods on the prototype.
   */
  proto: Record<string, Field>;
  values?: string[];
  /**
   * When true, the class will accept a MarkedArgumentBuffer* to create a
   * WTF::FixedVector<JSC::Unknown> jsvalueArray member that will be visited by GC.
   */
  valuesArray?: boolean;
  /**
   * Set this to `"0b11101110"`.
   */
  JSType?: string;
  noConstructor?: boolean;

  final?: boolean;

  /**
   * Class has an `estimated_size` function that reports external allocations to GC.
   * Called from any thread.
   *
   * When `true`, classes should have a method with this signature:
   * ```rust
   * pub fn estimated_size(&self) -> usize;
   * ```
   *
   * Report `size_of::<Self>()` as well as any external allocations.
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

  configurable?: boolean;
  enumerable?: boolean;
  structuredClone?: { transferable: boolean; tag: number; storable: boolean };
  inspectCustom?: boolean;
  /** With `--aot` the prototype is locked like a built-in's: no member can be replaced, added or deleted. Subclasses are unaffected. */
  lockedPrototype?: boolean;
  /** For the built-ins table: an instance's internal slots, the heap of its other state, and the TypeScript types that denote the class. */
  slots?: ClassColumns["slots"];
  stateHeap?: ClassColumns["stateHeap"];
  types?: ClassColumns["types"];

  constructor(options: Partial<ClassDefinition>) {
    this.name = options.name ?? "";
    this.klass = options.klass ?? {};
    this.proto = options.proto ?? {};

    Object.assign(this, options);
  }
}

export type DeclaredAlternative =
  | "string"
  | "number"
  | "int32"
  | "bigint"
  | "boolean"
  | "undefined"
  | "null"
  | "object" /* any object, functions too */
  | "Promise"
  | "this" /* the receiver itself */
  | { instance: string /* a class of a `.classes.ts` file, or one of `nativeInstances` in declared-type-checks.ts */ };

function parseDeclaredAlternative(word: string): DeclaredAlternative | undefined {
  switch (word) {
    case "string":
    case "number":
    case "int32":
    case "bigint":
    case "boolean":
    case "undefined":
    case "null":
    case "object":
    case "Promise":
    case "this":
      return word;
  }
  if (/^Promise<.*>$/.test(word)) return "Promise";
  return /^[A-Z][A-Za-z0-9]*$/.test(word) ? { instance: word } : undefined;
}

function splitDeclaredAlternatives(text: string): string[] {
  const words: string[] = [];
  let bracketDepth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === "<") bracketDepth++;
    else if (character === ">") bracketDepth--;
    else if (character === "|" && bracketDepth === 0) {
      words.push(text.slice(start, index));
      start = index + 1;
    }
  }
  words.push(text.slice(start));
  return words;
}

/**
 * A union, written with `|`, of `string`, `number`, `int32`, `bigint`, `boolean`, `undefined`, `null`, `object`, `Promise`
 * (or `Promise<T>`), `this` and names of classes.
 */
export function parseDeclaredType(text: string): DeclaredAlternative[] {
  const alternatives: DeclaredAlternative[] = [];
  const names = new Set<string>();
  for (const word of splitDeclaredAlternatives(text)) {
    const alternative = parseDeclaredAlternative(word.trim());
    const name = typeof alternative === "object" ? alternative.instance : alternative;
    if (name === undefined || names.has(name)) throw new Error(`'${text}' is not a declared type`);
    names.add(name);
    alternatives.push(alternative!);
  }
  return alternatives;
}

export function declaredTypeOf(field: Field): string | undefined {
  if ("getter" in field) return field.type;
  if ("fn" in field) return field.returns;
  return undefined;
}

export function isCheckedAtRuntime(field: Field): boolean {
  return ("getter" in field || "fn" in field) && field.checkedAtRuntime === true;
}

export function typeScriptOf(text: string): string {
  return text.replace(/\bint32\b/g, "number").replace(/\bPromise\b(?!<)/g, "Promise<unknown>");
}

/** The order in which a program sees the members of a class. */
export function sortFields(fields: Record<string, Field>): Record<string, Field> {
  return Object.fromEntries(Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Define a native class written in ZIg. Bun's codegen step will create CPP wrappers
 * for interacting with JSC.
 */
export function define(
  {
    klass = {},
    proto = {},
    values = [],
    overridesToJS = false,
    estimatedSize = false,
    call = false,
    construct = false,
    structuredClone,
    inspectCustom = false,
    ...rest
  } = {} as Partial<ClassDefinition>,
): ClassDefinition {
  if (inspectCustom) {
    proto.inspectCustom = {
      fn: "inspectCustom",
      length: 2,
      publicSymbol: "inspectCustom",
      name: "[nodejs.util.inspect.custom]",
    };
  }
  return new ClassDefinition({
    ...rest,
    // `refCounted` is a kind of finalize as far as the C++ wrapper is concerned.
    finalize: rest.finalize || rest.refCounted,
    call,
    overridesToJS,
    construct,
    estimatedSize,
    structuredClone,
    values,
    klass: sortFields(klass),
    proto: sortFields(proto),
  });
}
