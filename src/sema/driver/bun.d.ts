declare module "bun" {
  type int32 = number;
  /** One reason why {@link validate}, {@link safeValidate} or {@link parse} refused a value. */
  interface ValidationIssue {
    /** Where the value stands in what was handed over: property names and array indices. */
    path: (string | number)[];
    /** `"invalid_type"`, `"invalid_value"`, `"invalid_union"`, `"too_small"`, `"too_big"`, `"not_multiple_of"`, `"invalid_format"` or `"unrecognized_keys"`. */
    code: string;
    expected: string;
    received: string;
    message: string;
  }
  /**
   * Checks `value` against the TypeScript type `T` and returns a copy of it that is a `T`.
   * Throws a `TypeError` whose `issues` property lists every {@link ValidationIssue} otherwise.
   *
   * Properties that `T` does not declare are left out of the copy, unless `T` has an index signature.
   * Available in programs built or run with `--aot`.
   *
   * ```ts
   * import type { Int, Min, MaxLength } from "bun";
   * interface Order { id: number & Int & Min<1>; note?: string & MaxLength<100> }
   * const order = Bun.validate<Order>(await request.json());
   * ```
   */
  function validate<T>(value: unknown): T;
  /**
   * Parses `text` as JSON and checks the result against the TypeScript type `T`, as {@link validate} does, with one difference:
   * an optional property whose value does not match its type is left out instead of being an issue.
   * Throws a `SyntaxError` for text that is not JSON.
   */
  function parse<T>(text: string): T;
  /** {@link validate}, but returns the issues instead of throwing them. */
  function safeValidate<T>(value: unknown): { success: true; data: T } | { success: false; issues: ValidationIssue[] };
  /** What {@link schema} returns: a [Standard Schema](https://standardschema.dev). */
  interface Schema<T> {
    readonly "~standard": {
      readonly version: 1;
      readonly vendor: "bun";
      readonly validate: (value: unknown) => { readonly value: T; readonly issues?: undefined } | { readonly issues: readonly ValidationIssue[] };
      readonly types?: { readonly input: unknown; readonly output: T };
    };
  }
  /** The checks of {@link validate} for the type `T` as an object that libraries which take a Standard Schema accept. */
  function schema<T>(): Schema<T>;
  /** `number & Int`: a whole number. */
  type Int = { readonly "bun.int"?: true };
  /** `number & Min<1>`: at least 1. */
  type Min<N extends number> = { readonly "bun.min"?: N };
  /** `number & Max<100>`: at most 100. */
  type Max<N extends number> = { readonly "bun.max"?: N };
  /** `number & Above<0>`: more than 0. */
  type Above<N extends number> = { readonly "bun.above"?: N };
  /** `number & Below<1>`: less than 1. */
  type Below<N extends number> = { readonly "bun.below"?: N };
  /** `number & MultipleOf<5>` */
  type MultipleOf<N extends number> = { readonly "bun.multipleOf"?: N };
  /** `string & MinLength<1>` */
  type MinLength<N extends number> = { readonly "bun.minLength"?: N };
  /** `string & MaxLength<100>` */
  type MaxLength<N extends number> = { readonly "bun.maxLength"?: N };
  /** `string[] & MinItems<1>` */
  type MinItems<N extends number> = { readonly "bun.minItems"?: N };
  /** `string[] & MaxItems<10>` */
  type MaxItems<N extends number> = { readonly "bun.maxItems"?: N };
  /** `string & Pattern<"^[a-z]+$">`: the source of a regular expression that the string must match. */
  type Pattern<S extends string> = { readonly "bun.pattern"?: S };
  /** `string & Format<"uuid">` */
  type Format<S extends "email" | "uuid" | "ipv4" | "ipv6" | "date" | "date-time" | "url"> = { readonly "bun.format"?: S };
  /** `number & Min<1> & Message<"Order at least one">`: the message of the issues about this value. */
  type Message<S extends string> = { readonly "bun.message"?: S };
  /** `number & Default<8080>`: what stands in for `undefined` or a missing property. */
  type Default<V extends string | number | boolean | null> = { readonly "bun.default"?: V };
  /** `{ id: number } & Strict`: a property that the type does not declare is an issue. */
  type Strict = { readonly "bun.strict"?: true };
  /** {@link Strict} for the type and for every object type within it. */
  type DeepStrict = { readonly "bun.strict"?: "deep" };
}
