/**
 * `bun:guard` is a TypeScript runtime validation library with first-class JSON Schema support.
 *
 * ```ts
 * import { Guard } from "bun:guard";
 * import * as g from "bun:guard";
 *
 * const MyObj = g.object({
 *   a: g.string(),
 *   b: g.number(),
 *   c: g.boolean().optional(),
 * });
 * type MyObj = g.Infer<typeof MyObj>;
 * ```
 *
 * @category Guard
 */
declare module "bun:guard" {
  type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never;

  interface INonEmptyArray<T> extends Array<T> {
    0: T;
  }

  type NonEmptyArray<T> = [T, ...T[]] & INonEmptyArray<T>;

  type Simplify<T> = T extends Record<any, any> ? { [K in keyof T]: T[K] } : T;

  /**
   * An error that is thrown when a value fails validation.
   */
  class ParseError extends Error {
    actual: unknown;
    problems: { message: string; path: string[] }[];

    constructor(actual: unknown, problems: { message: string; path: string[] }[], verbose?: boolean);

    /**
     * Returns a new ParseError with actual values included in the error message.
     */
    verbose(): ParseError;
  }

  /**
   * The result of a `safeParse` call.
   */
  type ParseResult<T> =
    | { ok: true; value: T; altered: boolean }
    | { ok: false; error: ParseError };

  /**
   * Create a successful parse result.
   * @param altered Whether the value was transformed during parsing.
   */
  const ok: <T>(value: T, altered?: boolean) => ParseResult<T>;

  /**
   * Create a failed parse result.
   */
  const err: (
    actual: unknown,
    problems: string | { message: string; path: string[] }[],
  ) => ParseResult<never>;

  /**
   * Infer the output type of a Guard.
   *
   * ```ts
   * const MyString = g.string();
   * type MyString = g.Infer<typeof MyString>;
   * ```
   */
  type Infer<T> = T extends Guard<infer U, unknown>
    ? U
    : T extends []
      ? []
      : T extends [Guard<infer Head, unknown>, ...infer Rest]
        ? [Head, ...Infer<Rest>]
        : never;

  /**
   * Infer the input type of a Guard.
   *
   * ```ts
   * const MyNum = g.intoNumber();
   * type I = g.InferI<typeof MyNum>; // string | number
   * ```
   */
  type InferI<T> = T extends Guard<unknown, infer I> ? I : never;

  /**
   * A JSON Schema that never matches anything.
   */
  const JsonSchemaNever: { not: {} };

  /**
   * A subset of JSON Schema types used by this library.
   */
  type JsonSchema = (
    | Record<string, never>
    | typeof JsonSchemaNever
    | { type: "string"; pattern?: string }
    | { type: "number" }
    | { type: "boolean" }
    | { type: "null" }
    | { const: string | number | boolean | null }
    | { anyOf: JsonSchema[] }
    | { allOf: JsonSchema[] }
    | {
        type: "array";
        items: JsonSchema | JsonSchema[];
        additionalItems?: boolean;
      }
    | {
        type: "object";
        properties?: { [key: string]: JsonSchema };
        required?: string[];
        additionalProperties?: boolean | JsonSchema;
      }
  ) & { description?: string };

  /**
   * A Guard is a validator that can parse and validate values at runtime.
   *
   * Guards can be composed, transformed, and chained using methods like
   * `.optional()`, `.nullable()`, `.array()`, `.map()`, etc.
   */
  class Guard<T, I = T> {
    /**
     * Parse a value and return a result object indicating success or failure.
     */
    safeParse: (x: unknown) => ParseResult<T>;

    /**
     * The JSON Schema for the output type of this guard.
     */
    outputSchema: JsonSchema;

    /**
     * The JSON Schema for the input type of this guard.
     * May differ from outputSchema when coercion is involved.
     */
    inputSchema: JsonSchema;

    constructor(
      safeParse: (x: unknown) => ParseResult<T>,
      schemas?: { outputSchema?: JsonSchema; inputSchema?: JsonSchema },
    );

    /**
     * Create a lazy guard for recursive schemas.
     */
    static lazy: <T, I = unknown>(fn: () => Guard<T, I>) => Guard<T, I>;

    /**
     * Wrap a native TypeScript type guard (`x is T`) as a Guard.
     */
    static fromSimple: <T>(
      asserter: (
        x: unknown,
        reporter: (path: string[], message: string) => void,
      ) => x is T,
      schema?: JsonSchema,
    ) => Guard<T, T>;

    withSchema(schemas: { outputSchema?: JsonSchema; inputSchema?: JsonSchema }): Guard<T, I>;

    /**
     * Make this guard accept `undefined` as a valid value.
     */
    optional(): Guard<T | undefined, I | undefined>;

    /**
     * Make this guard accept `null` as a valid value.
     */
    nullable(): Guard<T | null, I | null>;

    /**
     * Make this guard accept both `null` and `undefined` as valid values.
     */
    nullish(): Guard<T | null | undefined, I | null | undefined>;

    /**
     * Reject `null` and `undefined`, making them invalid.
     */
    notNullish(): Guard<NonNullable<T>, NonNullable<I>>;

    /**
     * Transform this guard into one that validates arrays of `T`.
     */
    array(opts?: { fromNullish: boolean }): Guard<T[], I[]>;

    /**
     * Transform this guard into one that validates non-empty arrays of `T`.
     */
    arrayNonEmpty(): Guard<NonEmptyArray<T>, NonEmptyArray<I>>;

    /**
     * Combine with another guard — the value must match both.
     */
    and<U, I2>(other: Guard<U, I2>): Guard<T & U, I & I2>;

    /**
     * Combine with another guard — the value can match either.
     */
    or<U, I2>(other: Guard<U, I2>): Guard<T | U, I | I2>;

    /**
     * Accept a JSON string or the native type.
     */
    orFromJson(): Guard<T, T | string>;

    /**
     * Transform the parsed value.
     */
    map<U>(
      predicateOrGuard: Guard<U, any> | ((x: T) => U | ParseResult<U>),
      outputSchema?: JsonSchema,
    ): Guard<U, I>;

    /**
     * Add an additional validation predicate.
     */
    invariant(predicate: (x: T) => boolean, message: string): Guard<T, I>;

    /**
     * Add a brand to the output type for nominal typing.
     */
    brand<S extends string>(_name: S): Guard<T & { [K in `Brand:${S}`]: true }, I>;

    /**
     * Parse a value, throwing a ParseError on failure.
     * If `_default` is provided, it is returned on failure instead of throwing.
     */
    parse(x: I, _default?: T): T;

    /**
     * Type-narrowing check. Returns true if the value matches and no coercion occurred.
     */
    is(x: unknown): x is T;

    /**
     * Add a description to the JSON Schema output.
     */
    describe(description: string): Guard<T, I>;
  }

  /**
   * Create a guard that always passes, but offers no type narrowing.
   */
  const unknown: () => Guard<unknown, unknown>;

  /**
   * Create a guard that matches only `null`.
   */
  const nul: () => Guard<null, null>;

  /**
   * Create a guard that matches only `undefined`.
   */
  const undef: () => Guard<undefined, undefined>;

  /**
   * Create a guard that validates numbers.
   */
  const number: () => Guard<number, number>;

  /**
   * Create a guard that validates strings.
   */
  const string: () => Guard<string, string>;

  /**
   * Create a guard that validates a string matches a regular expression.
   */
  const regex: (re: string | RegExp) => Guard<string, string>;

  /**
   * Create a guard that validates booleans.
   */
  const boolean: () => Guard<boolean, boolean>;

  /**
   * Create a guard that validates bigints.
   */
  const bigint: () => Guard<bigint, bigint>;

  /**
   * Create a guard that validates symbols.
   */
  const symbol: () => Guard<symbol, symbol>;

  /**
   * Create a guard that validates integer numbers.
   */
  const int: () => Guard<number, number>;

  /**
   * Create a guard that validates finite numbers (not Infinity or NaN).
   */
  const finite: () => Guard<number, number>;

  /**
   * Create a guard that validates NaN.
   */
  const nan: () => Guard<number, number>;

  /**
   * Create a guard that matches literal values.
   */
  const literal: <T extends (string | number | boolean | null | undefined)[]>(
    ...value: T
  ) => Guard<T[number], T[number]>;

  /**
   * Create a guard that validates the shape of an object.
   */
  const object: <O extends Record<string, Guard<unknown, any>>>(
    spec: O,
    opts?: { strict?: boolean; passthrough?: boolean },
  ) => Guard<
    Simplify<
      { [K in keyof { [K in keyof O]: Infer<O[K]> } as undefined extends { [K in keyof O]: Infer<O[K]> }[K] ? K : never]?: Exclude<{ [K in keyof O]: Infer<O[K]> }[K], undefined> }
      & { [K in keyof { [K in keyof O]: Infer<O[K]> } as undefined extends { [K in keyof O]: Infer<O[K]> }[K] ? never : K]: { [K in keyof O]: Infer<O[K]> }[K] }
    >,
    Simplify<
      { [K in keyof { [K in keyof O]: InferI<O[K]> } as undefined extends { [K in keyof O]: InferI<O[K]> }[K] ? K : never]?: Exclude<{ [K in keyof O]: InferI<O[K]> }[K], undefined> }
      & { [K in keyof { [K in keyof O]: InferI<O[K]> } as undefined extends { [K in keyof O]: InferI<O[K]> }[K] ? never : K]: { [K in keyof O]: InferI<O[K]> }[K] }
    >
  >;

  /**
   * Create a guard that validates record-like objects (any key, typed values).
   */
  const record: <K extends string, V extends Guard<unknown, any>>(
    keyGuard: Guard<K>,
    valueGuard: V,
  ) => Guard<Record<K, Infer<V>>, Record<K, InferI<V>>>;

  /**
   * Create a guard that validates a Map with keys and values matching the given guards.
   */
  const map: <K extends Guard<any, any>, V extends Guard<any, any>>(
    keyGuard: K,
    valueGuard: V,
  ) => Guard<Map<Infer<K>, Infer<V>>, Map<InferI<K>, InferI<V>>>;

  /**
   * Create a guard that validates a Set with elements matching the given guard.
   */
  const set: <T extends Guard<any, any>>(itemGuard: T) => Guard<Set<Infer<T>>, Set<InferI<T>>>;

  /**
   * Create a guard that validates arrays with a given item guard.
   */
  const array: <T extends Guard<any, any>>(itemGuard: T) => Guard<Array<Infer<T>>, Array<InferI<T>>>;

  /**
   * Create a guard that validates non-empty arrays.
   */
  const arrayNonEmpty: <T extends Guard<any, any>>(
    itemGuard: T,
  ) => Guard<NonEmptyArray<Infer<T>>, NonEmptyArray<InferI<T>>>;

  /**
   * Create a guard that validates a value matches all of the given guards.
   */
  const allOf: <G extends Guard<any, any>[]>(
    ...guards: G
  ) => Guard<UnionToIntersection<Infer<G[number]>>, UnionToIntersection<InferI<G[number]>>>;

  /**
   * Create a guard that validates a value matches one of the given guards.
   */
  const oneOf: <G extends Guard<unknown, any>[]>(
    ...guards: G
  ) => Guard<Infer<G[number]>, InferI<G[number]>>;

  /**
   * Create a guard that validates a fixed-length tuple.
   */
  const tuple: <G extends readonly Guard<unknown, any>[]>(
    ...guards: G
  ) => Guard<Infer<G>, { [K in keyof G]: InferI<G[K]> }>;

  /**
   * Create a guard that checks instanceof.
   */
  const instanceOf: <C extends new (...args: any[]) => any>(
    ctor: C,
  ) => Guard<InstanceType<C>, InstanceType<C>>;

  /**
   * Parse a value as a number (coerces from string).
   */
  const intoNumber: () => Guard<number, string | number>;

  /**
   * Parse a value as a string (coerces from number, bigint, boolean, symbol, Date).
   */
  const intoString: () => Guard<string, string | number | bigint | boolean | symbol | Date>;

  /**
   * Parse a JSON string against a guard.
   */
  const fromJson: <G extends Guard<unknown, any>>(guard: G) => Guard<Infer<G>, string>;

  /**
   * Serialize a value as JSON.
   */
  const intoJson: () => Guard<string, unknown>;

  /**
   * Extract regex match groups.
   */
  const fromRegex: (re: string | RegExp) => Guard<RegExpExecArray, string>;

  /**
   * Parse a date from a string, number, bigint, or Date object.
   */
  const intoDate: () => Guard<Date, string | number | bigint | Date>;
}
