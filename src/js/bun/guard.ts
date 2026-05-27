// type UnionToIntersection<U> = (distribute U) extends (exploit contravariance of type parameter inference)
//                                <DISTRIBUTE>                           <CONTRAVARIANCE>
//
// 1. <DISTRIBUTE>: A | B becomes: ((k: A) => void) | ((k: B) => void)
// 2. <CONTRAVARIANCE>: For the union of functions to extend `(k: infer I) => void`,
//    I must be assignable to every parameter (contravariance), so:
//    I = A & B
type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never;
interface INonEmptyArray<T> extends Array<T> {
  0: T;
}
type NonEmptyArray<T> = [T, ...T[]] & INonEmptyArray<T>;

type Simplify<T> = T extends Record<any, any> ? { [K in keyof T]: T[K] } : T;

type UndefinedToOptional<T> = Simplify<
  {
    // Only include keys that extend undefined, redefining their type to be optional properties:
    [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
  } & {
    // Only include keys that DON'T extend undefined:
    [K in keyof T as undefined extends T[K] ? never : K]: T[K];
  }
>;

class ParseError extends Error {
  private static _tryToJson(actual: unknown, path: string[]) {
    const got = ParseError._get(actual, path);
    try {
      return JSON.stringify(got);
    } catch (_) {
      return String(got);
    }
  }

  private static _get(actual: unknown, path: string[]) {
    try {
      let curr: any = actual;
      for (const p of path) {
        curr = curr?.[p];
      }
      return curr;
    } catch (_e) {
      return null;
    }
  }

  public actual: unknown;
  public problems: { message: string; path: string[] }[];

  constructor(actual: unknown, problems: { message: string; path: string[] }[], verbose = false) {
    super(
      `Failed guard (${problems.length} problem${problems.length > 1 ? "s" : ""}):\n${problems.map((p, idx) => `  ${idx + 1}. \`${p.path.join(".")}\`: "${p.message}${verbose ? ` (got: ${ParseError._tryToJson(actual, p.path)})` : ""}"`).join("\n")}`,
    );
    this.actual = actual;
    this.problems = problems;
    this.name = "ParseError";
  }

  verbose() {
    return new ParseError(this.actual, this.problems, true);
  }
}
type ParseResult<T> = { ok: true; value: T; altered: boolean } | { ok: false; error: ParseError };
const isResult = (x: unknown): x is ParseResult<unknown> =>
  x !== null && typeof x === "object" && "ok" in x && typeof x.ok === "boolean";

const ok = <T,>(value: T, altered = true) => ({ ok: true, value, altered }) as ParseResult<T>;
const err = (actual: unknown, problems: string | { message: string; path: string[] }[]) =>
  ({
    ok: false,
    error: new ParseError(actual, typeof problems === "string" ? [{ message: problems, path: [] }] : problems),
  }) as ParseResult<never>;

/**
 * Infer the guarded type of a given Guard.
 *
 * Example:
 *
 * ```typescript
 * const MyString = g.string();
 * type MyString = g.Infer<typeof MyString>
 * ```
 */
type Infer<T> =
  T extends Guard<infer U, unknown>
    ? U
    : T extends []
      ? []
      : T extends [Guard<infer Head, unknown>, ...infer Rest]
        ? [Head, ...Infer<Rest>]
        : never;

type InferI<T> = T extends Guard<unknown, infer I> ? I : never;

/**
 * A JSON Schema that doesn't match anything
 */
const JsonSchemaNever = { not: {} };

/**
 * JSON Schema types. These are a subset of what JSON Schema can represent, but
 * suffice for this small implementation of type validation.
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
 * Safely get the description from a JsonSchema (may be undefined if the schema
 * is JsonSchemaNever which has no description field).
 */
const jsonSchemaDescription = (schema: JsonSchema): string | undefined => {
  if ("description" in schema) return schema.description;
  return undefined;
};

const jsonSchemaIsNullable = (schema: JsonSchema) => {
  //
  // The current type is optional if it looks like this:
  // { anyOf: [ <type>, { type: "null" } ] }
  //
  if ("anyOf" in schema && schema.anyOf.length === 2 && "type" in schema.anyOf[1]! && schema.anyOf[1].type === "null") {
    // Hoist the type up to the top level: it will be optional
    // by default...
    return { nullable: true, innerType: schema.anyOf[0]! };
  }

  // ...otherwise, it's required
  return { nullable: false, innerType: schema };
};

/**
 * A guard builds on a parser in that it offers chainable methods (such as
 * `.optional()` or `.array()`, for example) that alter how the parser behaves.
 */
class Guard<T, I = T> {
  public safeParse: (x: unknown) => ParseResult<T>;
  public outputSchema: JsonSchema;
  public inputSchema: JsonSchema;
  constructor(
    safeParse: (x: unknown) => ParseResult<T>,
    schemas: { outputSchema?: JsonSchema; inputSchema?: JsonSchema } = {},
  ) {
    this.safeParse = safeParse;
    this.outputSchema = schemas.outputSchema ?? JsonSchemaNever;
    this.inputSchema = schemas.inputSchema ?? this.outputSchema;
  }

  /**
   * Convert a native `x is T` type guard into a Guard.
   */
  static lazy = <T, I = unknown>(fn: () => Guard<T, I>): Guard<T, I> => new Guard(x => fn().safeParse(x));

  static fromSimple = <T,>(
    asserter: (x: unknown, reporter: (path: string[], message: string) => void) => x is T,
    schema: JsonSchema = JsonSchemaNever,
  ): Guard<T, T> =>
    new Guard(
      x => {
        const problem = { path: [] as string[], message: "failed assertion" };
        const reporter = (path: string[], message: string) => {
          problem.path = path;
          problem.message = message;
        };
        if (asserter(x, reporter)) return ok(x, false);
        return err(x, [problem]);
      },
      { outputSchema: schema },
    );

  withSchema(schemas: { outputSchema?: JsonSchema; inputSchema?: JsonSchema }) {
    return new Guard<T, I>(this.safeParse, {
      outputSchema: schemas.outputSchema ?? this.outputSchema,
      inputSchema: schemas.inputSchema ?? this.inputSchema,
    });
  }

  optional() {
    return new Guard<T | undefined, I | undefined>(x => (x === undefined ? ok(x, false) : this.safeParse(x)), {
      outputSchema: {
        anyOf: [this.outputSchema, { type: "null" }],
        description: jsonSchemaDescription(this.outputSchema),
      },
      inputSchema: {
        anyOf: [this.inputSchema, { type: "null" }],
        description: jsonSchemaDescription(this.inputSchema),
      },
    });
  }

  nullable() {
    return new Guard<T | null, I | null>(x => (x === null ? ok(x, false) : this.safeParse(x)), {
      outputSchema: {
        anyOf: [this.outputSchema, { type: "null" }],
        description: jsonSchemaDescription(this.outputSchema),
      },
      inputSchema: {
        anyOf: [this.inputSchema, { type: "null" }],
        description: jsonSchemaDescription(this.inputSchema),
      },
    });
  }

  nullish() {
    return new Guard<T | null | undefined, I | null | undefined>(
      x => (x === undefined || x === null ? ok(x, false) : this.safeParse(x)),
      {
        outputSchema: {
          anyOf: [this.outputSchema, { type: "null" }],
          description: jsonSchemaDescription(this.outputSchema),
        },
        inputSchema: {
          anyOf: [this.inputSchema, { type: "null" }],
          description: jsonSchemaDescription(this.inputSchema),
        },
      },
    );
  }

  notNullish() {
    return new Guard<NonNullable<T>, NonNullable<I>>(
      x => {
        if (x === null || x === undefined) {
          return err(x, "Expected non-nullish value");
        }
        return this.safeParse(x) as ParseResult<NonNullable<T>>;
      },
      {
        outputSchema: jsonSchemaIsNullable(this.outputSchema).innerType,
        inputSchema: jsonSchemaIsNullable(this.inputSchema).innerType,
      },
    );
  }

  /**
   * Transform the current `Guard<T>` to one that matches `Guard<T[]>`.
   */
  array(opts?: { fromNullish: boolean }) {
    return new Guard<T[], I[]>(
      x => {
        if (opts?.fromNullish === true && (x === null || x === undefined)) {
          return ok([], true);
        }
        if (!Array.isArray(x)) {
          return err(x, "Expected array");
        }

        let altered = false;
        const newArray = [] as T[];
        const errors: { message: string; path: string[] }[] = [];
        let idx = 0;
        for (const i of x) {
          const result = this.safeParse(i);
          switch (result.ok) {
            case true:
              newArray.push(result.value);
              altered ||= result.altered;
              break;
            case false:
              errors.push(
                ...result.error.problems.map(p => ({
                  message: p.message,
                  path: [idx.toString(), ...p.path],
                })),
              );
              break;
          }
          idx++;
        }

        return errors.length === 0 ? ok((altered ? newArray : x) as T[], altered) : err(x, errors);
      },
      {
        outputSchema: {
          type: "array",
          items: this.outputSchema,
          description: jsonSchemaDescription(this.outputSchema),
        },
        inputSchema: {
          type: "array",
          items: this.inputSchema,
          description: jsonSchemaDescription(this.inputSchema),
        },
      },
    );
  }

  /**
   * Transform the current `Guard<T>` to one that matches `Guard<[T, ...T[]]>`.
   */
  arrayNonEmpty(): Guard<NonEmptyArray<T>, NonEmptyArray<I>> {
    const arrayGuard = this.array();
    return arrayGuard
      .map(x => {
        if (x.length === 0) return err(x, "Expected an array with length > 0");
        return ok(x as NonEmptyArray<T>, false);
      })
      .withSchema({
        outputSchema: arrayGuard.outputSchema,
        inputSchema: arrayGuard.inputSchema,
      });
  }

  /**
   * Combine two guards into one that matches both.
   */
  and<U, I2>(other: Guard<U, I2>): Guard<T & U, I & I2> {
    return allOf(this, other) as Guard<T & U, I & I2>;
  }

  /**
   * Combine two guards into one that matches either of the two.
   */
  or<U, I2>(other: Guard<U, I2>): Guard<T | U, I | I2> {
    return oneOf(this, other) as Guard<T | U, I | I2>;
  }

  /**
   * If the input is a string, try to parse it as JSON and then validate against
   * this schema
   */
  orFromJson(): Guard<T, T | string> {
    const jsonGuard = fromJson(this) as Guard<T, string>;
    return new Guard<T, T | string>(
      x => {
        if (string().is(x)) {
          const result = jsonGuard.safeParse(x);
          if (result.ok) return result;
        }
        return this.safeParse(x);
      },
      {
        outputSchema: this.outputSchema,
        inputSchema: {
          anyOf: [this.inputSchema, { type: "string" }],
          description: jsonSchemaDescription(this.inputSchema),
        },
      },
    );
  }

  /**
   * Map a value to another value using a function/guard.
   *
   * @example
   * ```typescript
   * const MyNumber = g.number().map(x => x + 1);
   * const JwtExp = g
   *   .matchRegexp(/^[^.]+\.([^.]+)\.[^.]+$/)
   *   .invariant((groups) => groups.length === 2, "Invalid JWT format")
   *   .map((groups) => atob(groups[1]))
   *   .map(
   *     g.fromJson(
   *       g.object({
   *         exp: g.number(),
   *       }),
   *     ),
   *   )
   *   .map(({ exp }) => exp);
   * ```
   */
  map<U>(predicateOrGuard: Guard<U, any> | ((x: T) => U | ParseResult<U>), outputSchema?: JsonSchema) {
    const resolvedOutputSchema =
      outputSchema ?? (predicateOrGuard instanceof Guard ? predicateOrGuard.outputSchema : JsonSchemaNever);
    return new Guard<U, I>(
      x => {
        const result = this.safeParse(x);
        switch (result.ok) {
          case true: {
            const x2 =
              predicateOrGuard instanceof Guard
                ? predicateOrGuard.safeParse(result.value)
                : predicateOrGuard(result.value);

            if (isResult(x2)) {
              if (x2.ok) {
                // carry forward `altered` on Ok values:
                x2.altered ||= result.altered;
              }
              return x2;
            }

            const altered = result.altered || !Object.is(result.value, x2)
            return ok(x2, altered);
          }
          case false: {
            return result;
          }
        }
      },
      {
        outputSchema: resolvedOutputSchema,
        inputSchema: this.inputSchema,
      },
    );
  }

  invariant(predicate: (x: T) => boolean, message: string) {
    return this.map(x => {
      if (!predicate(x)) return err(x, message);
      return ok(x, false);
    });
  }

  brand<S extends string>(_name: S): Guard<T & { [K in `Brand:${S}`]: true }, I> {
    return this as Guard<T & { [K in `Brand:${S}`]: true }, I>;
  }

  /**
   * Parse the given value, returning T.
   */
  parse(x: I, _default?: T): T {
    const result = this.safeParse(x);
    if (!result.ok) {
      // biome-ignore lint/complexity/noArguments: what if _default is literally undefined? We need to actually test if the argument is there:
      if (arguments.length === 2) return _default as any;
      throw result.error;
    }
    return result.value;
  }

  /**
   * Check if a value is of type T. Uses TypeScript's built-in `x is T` type-narrowing mechanism
   */
  is(x: unknown): x is T {
    const result = this.safeParse(x);
    return result.ok && !result.altered;
  }

  /**
   * Describe the guard (adds a description to the generated JSON Schema)
   */
  describe(description: string): Guard<T, I> {
    return new Guard<T, I>(this.safeParse, {
      outputSchema: { description, ...this.outputSchema } as JsonSchema & { description?: string },
      inputSchema: { description, ...this.inputSchema } as JsonSchema & { description?: string },
    });
  }
}

/**
 * Create a guard that always passes, but offers no type narrowing.
 */
const unknown = () => new Guard(x => ok(x, false), { outputSchema: {} });

/**
 * Matches `null`
 */
const nul = () =>
  new Guard(x => (x === null ? ok(x, false) : err(x, "Expected null")), {
    outputSchema: { type: "null" },
  });

/**
 * Matches `undefined`
 */
const undef = () =>
  new Guard(x => (x === undefined ? ok(x, false) : err(x, "Expected undefined")), {
    outputSchema: { type: "null" },
  });

/**
 * Validate that a value is a number.
 */
const number = () =>
  new Guard<number>(x => (typeof x === "number" ? ok(x, false) : err(x, "Expected number")), {
    outputSchema: { type: "number" },
  });

/**
 * Validate that a value is a string.
 */
const string = () =>
  new Guard<string>(x => (typeof x === "string" ? ok(x, false) : err(x, "Expected string")), {
    outputSchema: { type: "string" },
  });

/**
 * Validate that a value is a string that matches a given regex.
 */
const regex = (re: string | RegExp) => {
  const normalizedRe = typeof re === "string" ? new RegExp(re) : re;
  return string().map(
    x => {
      const reCopy = new RegExp(normalizedRe.source, normalizedRe.flags);
      return reCopy.test(x) ? ok(x, false) : err(x, "Expected string matching regex");
    },
    { type: "string", pattern: normalizedRe.source },
  );
};

/**
 * Validate that a value is a boolean.
 */
const boolean = () =>
  new Guard<boolean>(x => (typeof x === "boolean" ? ok(x, false) : err(x, "Expected boolean")), {
    outputSchema: { type: "boolean" },
  });

/**
 * Validate that a value is null.
 */
const bigint = () => new Guard<bigint>(x => (typeof x === "bigint" ? ok(x, false) : err(x, "Expected bigint")));

const symbol = () => new Guard<symbol>(x => (typeof x === "symbol" ? ok(x, false) : err(x, "Expected symbol")));

/**
 * Validate that a value is an integer.
 */
const int = () =>
  new Guard<number>(x => (Number.isInteger(x) ? ok(x as number, false) : err(x, "Expected integer")), {
    outputSchema: { type: "number" },
  });

/**
 * Validate that a value is a finite number (not Infinity or NaN).
 */
const finite = () =>
  new Guard<number>(
    x => (typeof x === "number" && Number.isFinite(x) ? ok(x as number, false) : err(x, "Expected finite number")),
    {
      outputSchema: { type: "number" },
    },
  );

/**
 * Validate that a value is NaN.
 */
const nan = () => new Guard<number>(x => (Number.isNaN(x) ? ok(x as number, false) : err(x, "Expected NaN")));

const literal = <T extends (string | number | boolean | null | undefined)[],>(...value: T) =>
  new Guard<T[number]>(x => (value.includes(x as any) ? ok(x as T[number], false) : err(x, "Expected literal")), {
    outputSchema: {
      anyOf: value.map(v => (v === undefined || v === null ? { type: "null" } : { const: v })),
    },
  });

/**
 * Validate that a value is an object and that it matches a given shape.
 */
const object = <O extends Record<string, Guard<unknown, any>>,>(
  spec: O,
  opts?: { strict?: boolean; passthrough?: boolean },
) => {
  if (opts?.strict === true && opts?.passthrough === true) {
    throw new Error('Cannot set "strict" and "passthrough" at the same time');
  }

  const buildObjectSchema = (getSchema: (g: Guard<any, any>) => JsonSchema) => {
    const required: string[] = [];
    const properties = Object.fromEntries(
      Object.entries(spec).map(([k, v]) => {
        const schema = getSchema(v);
        // A property is required unless undefined is a valid value.
        // This correctly distinguishes optional (T | undefined) and nullish
        // (T | null | undefined) from nullable (T | null), where the key
        // must be present even though null is a valid value.
        const isOptional = v.safeParse(undefined).ok === true;
        const allowNull = v.safeParse(null).ok === true;
        if (!isOptional) {
          required.push(k);
        }
        // When the schema has anyOf: [T, null] but null is not actually a
        // valid value (e.g., .optional()), strip the anyOf wrapper since the
        // optional-ness is conveyed by the property not being in `required`.
        // When null IS valid (.nullable() or .nullish()), keep the anyOf so
        // the schema correctly accepts null values.
        const info = jsonSchemaIsNullable(schema);
        const propertySchema = info.nullable && !allowNull ? info.innerType : schema;
        return [k, propertySchema];
      }),
    );
    return {
      type: "object" as const,
      properties,
      required,
      additionalProperties: !(opts?.strict ?? false),
    };
  };

  return new Guard<
    UndefinedToOptional<{ [K in keyof O]: Infer<O[K]> }>,
    UndefinedToOptional<{ [K in keyof O]: InferI<O[K]> }>
  >(
    x => {
      const strict = opts?.strict ?? false;
      const passthrough = opts?.passthrough ?? true;

      if (typeof x !== "object" || x === null || x === undefined) {
        return err(x, "Expected object");
      }

      let altered = false;
      const newObject = {} as any;
      const allKeys = new Set([...Object.keys(x), ...Object.keys(spec)]);
      const errors: { message: string; path: string[] }[] = [];
      for (const k of allKeys) {
        if (spec[k] === undefined && strict) {
          errors.push({ message: `Unexpected key: ${k}`, path: [k] });
          continue;
        }
        if (spec[k] === undefined && !passthrough) {
          altered = true;
          continue;
        }

        const kGuard = spec[k];
        const xValue = (x as any)[k];
        if (!kGuard) {
          newObject[k] = xValue;
          continue;
        }
        const kResult = kGuard.safeParse(xValue);
        switch (kResult.ok) {
          case true: {
            newObject[k] = kResult.value;
            altered ||= kResult.altered;
            break;
          }

          case false: {
            errors.push(
              ...kResult.error.problems.map(p => ({
                message: p.message,
                path: [k, ...p.path],
              })),
            );
            break;
          }
        }
      }

      if (errors.length === 0) {
        if (altered) Object.setPrototypeOf(newObject, Object.getPrototypeOf(x));
        return ok((altered ? newObject : x) as any, altered);
      }
      return err(x, errors);
    },
    {
      outputSchema: buildObjectSchema(g => g.outputSchema),
      inputSchema: buildObjectSchema(g => g.inputSchema),
    },
  );
};

/**
 * Validate that a value is an object and that it matches a given shape.
 */
const record = <K extends string, V extends Guard<unknown, any>,>(keyGuard: Guard<K>, valueGuard: V) =>
  new Guard<Record<K, Infer<V>>, Record<K, InferI<V>>>(
    (x): ParseResult<Record<K, Infer<V>>> => {
      if (typeof x !== "object" || x === null || x === undefined) {
        return err(x, "Expected object");
      }

      let altered = false;
      const errors: { message: string; path: string[] }[] = [];
      const newObject = {} as Record<K, Infer<V>>;
      for (const [k, v] of Object.entries(x)) {
        const keyResult = keyGuard.safeParse(k);
        const valueResult = valueGuard.safeParse(v);
        switch (keyResult.ok) {
          case true: {
            altered ||= keyResult.altered;
            break;
          }
          case false: {
            errors.push(
              ...keyResult.error.problems.map(p => ({
                message: `Key failed validation: ${p.message}`,
                path: [k, ...p.path],
              })),
            );
            break;
          }
        }
        switch (valueResult.ok) {
          case true: {
            altered ||= valueResult.altered;
            break;
          }
          case false: {
            errors.push(...valueResult.error.problems.map(p => ({ ...p, path: [k, ...p.path] })));
            break;
          }
        }
        if (keyResult.ok && valueResult.ok) {
          newObject[keyResult.value] = valueResult.value as Infer<V>;
        }
      }

      return errors.length === 0 ? ok((altered ? newObject : x) as any, altered) : err(x, errors);
    },
    {
      outputSchema: {
        type: "object",
        additionalProperties: valueGuard.outputSchema,
      },
      inputSchema: {
        type: "object",
        additionalProperties: valueGuard.inputSchema,
      },
    },
  );

/**
 * Validate that a value is a Map with keys and values matching the given guards.
 */
const map = <K extends Guard<any, any>, V extends Guard<any, any>,>(keyGuard: K, valueGuard: V) =>
  new Guard<Map<Infer<K>, Infer<V>>, Map<InferI<K>, InferI<V>>>(
    x => {
      if (!(x instanceof Map)) {
        return err(x, "Expected Map");
      }

      let altered = false;
      const newMap = new Map<Infer<K>, Infer<V>>();
      const errors: { message: string; path: string[] }[] = [];
      let idx = 0;
      for (const [key, value] of x) {
        const keyResult = keyGuard.safeParse(key);
        const valueResult = valueGuard.safeParse(value);

        switch (keyResult.ok) {
          case true:
            altered ||= keyResult.altered;
            break;
          case false:
            errors.push(
              ...keyResult.error.problems.map(p => ({
                message: `Key failed validation: ${p.message}`,
                path: [idx.toString(), "key", ...p.path],
              })),
            );
            break;
        }

        switch (valueResult.ok) {
          case true:
            altered ||= valueResult.altered;
            break;
          case false:
            errors.push(
              ...valueResult.error.problems.map(p => ({
                message: p.message,
                path: [idx.toString(), "value", ...p.path],
              })),
            );
            break;
        }

        if (keyResult.ok && valueResult.ok) {
          newMap.set(keyResult.value, valueResult.value as Infer<V>);
        }
        idx++;
      }

      return errors.length === 0 ? ok(altered ? newMap : (x as Map<Infer<K>, Infer<V>>), altered) : err(x, errors);
    },
    {
      outputSchema: { type: "object", additionalProperties: valueGuard.outputSchema },
      inputSchema: { type: "object", additionalProperties: valueGuard.inputSchema },
    },
  );

/**
 * Validate that a value is a Set with elements matching the given guard.
 */
const set = <T extends Guard<any, any>,>(itemGuard: T) =>
  new Guard<Set<Infer<T>>, Set<InferI<T>>>(
    x => {
      if (!(x instanceof Set)) {
        return err(x, "Expected Set");
      }

      let altered = false;
      const newSet = new Set<Infer<T>>();
      const errors: { message: string; path: string[] }[] = [];
      let idx = 0;
      for (const item of x) {
        const result = itemGuard.safeParse(item);
        switch (result.ok) {
          case true:
            newSet.add(result.value);
            altered ||= result.altered;
            break;
          case false:
            errors.push(
              ...result.error.problems.map(p => ({
                message: p.message,
                path: [idx.toString(), ...p.path],
              })),
            );
            break;
        }
        idx++;
      }

      return errors.length === 0 ? ok(altered ? newSet : (x as Set<Infer<T>>), altered) : err(x, errors);
    },
    {
      outputSchema: { type: "array", items: itemGuard.outputSchema },
      inputSchema: { type: "array", items: itemGuard.inputSchema },
    },
  );

/**
 * Validate that all elements of an array match the given type-guard.
 */
const array = <T extends Guard<any, any>,>(itemGuard: T) =>
  itemGuard.array() as Guard<Array<Infer<T>>, Array<InferI<T>>>;

/**
 * Validate that all elements of an array match the given type-guard, and that the array is non-empty.
 */
const arrayNonEmpty = <T extends Guard<any, any>,>(itemGuard: T) =>
  itemGuard.arrayNonEmpty() as Guard<NonEmptyArray<Infer<T>>, NonEmptyArray<InferI<T>>>;

/**
 * Validate that a given object matches all of the specified guards.
 */
const allOf = <G extends Guard<any, any>[],>(...guards: G) =>
  new Guard<UnionToIntersection<Infer<G[number]>>, UnionToIntersection<InferI<G[number]>>>(
    x => {
      let curr = x;
      let altered = false;
      for (const guard of guards) {
        const result = guard.safeParse(curr);
        switch (result.ok) {
          case true: {
            curr = result.value as any;
            altered ||= result.altered;
            break;
          }
          case false: {
            return err(x, [
              {
                message: "Expected value to match all guards",
                path: [],
              },
              ...result.error.problems,
            ]);
          }
        }
      }
      return ok(curr as any, altered);
    },
    {
      outputSchema: { allOf: guards.map(g => g.outputSchema) },
      inputSchema: { allOf: guards.map(g => g.inputSchema) },
    },
  );

/**
 * Validate that a given object matches one of the specified guards.
 */
const oneOf = <G extends Guard<unknown, any>[],>(...guards: G) =>
  new Guard<Infer<G[number]>, InferI<G[number]>>(
    x => {
      for (const guard of guards) {
        const result = guard.safeParse(x);
        if (result.ok) {
          return result as ParseResult<Infer<G[number]>>;
        }
      }
      return err(x as any, "Expected one of the options");
    },
    {
      outputSchema: { anyOf: guards.map(g => g.outputSchema) },
      inputSchema: { anyOf: guards.map(g => g.inputSchema) },
    },
  );

/**
 * Validate that a given value is an array of fixed length, with each
 * correspending item matching the specified guards.
 */
const tuple = <G extends readonly Guard<unknown, any>[],>(...guards: G) => {
  const expectedLength = guards.length;
  return new Guard<Infer<G>, { [K in keyof G]: InferI<G[K]> }>(
    x => {
      if (!Array.isArray(x)) {
        return err(x, "Expected a tuple, got non-list");
      }
      if (x.length !== expectedLength) {
        return err(x, `Expected tuple of length ${expectedLength}`);
      }

      const newTuple = [] as any[];
      let altered = false;
      const errors: { message: string; path: string[] }[] = [];
      for (let i = 0; i < guards.length; ++i) {
        const result = guards[i]!.safeParse(x[i]);
        switch (result.ok) {
          case true: {
            altered ||= result.altered;
            newTuple.push(result.value);
            break;
          }
          case false: {
            errors.push(
              ...result.error.problems.map(p => ({
                message: p.message,
                path: [i.toString(), ...p.path],
              })),
            );
            break;
          }
        }
      }

      return errors.length === 0 ? ok(altered ? newTuple : (x as any), altered) : err(x, errors);
    },
    {
      outputSchema: {
        type: "array",
        items: guards.map(g => g.outputSchema).filter(x => typeof x !== "undefined") as JsonSchema[],
        additionalItems: false,
      },
      inputSchema: {
        type: "array",
        items: guards.map(g => g.inputSchema).filter(x => typeof x !== "undefined") as JsonSchema[],
        additionalItems: false,
      },
    },
  );
};

/**
 * Validate that a given input is an instance of the provided constructor
 */
const instanceOf = <C extends new (...args: any[]) => any,>(ctor: C) =>
  new Guard((x: unknown) =>
    x instanceof ctor ? ok(x as InstanceType<C>, false) : err(x, `Expected instance of ${ctor.name}`),
  );

/**
 * Parse a value as a number.
 */
const intoNumber = (): Guard<number, string | number> =>
  oneOf(string(), number()).map(
    x => {
      if (typeof x === "number") return ok(x, false);
      if (["-", "+", ".", ""].includes(x) || !/^[+-]?[0-9]*\.?[0-9]*$/.test(x)) {
        return err(x, "Expected string matching number format");
      }
      const n = Number.parseFloat(x);
      return !Number.isNaN(n) ? ok(n, true) : err(x, "Could not parse as number");
    },
    { type: "number" },
  );

/**
 * Parse a value as a string.
 */
const intoString = (): Guard<string, string | number | bigint | boolean | symbol | Date> =>
  new Guard(
    x => {
      if (typeof x === "string") return ok(x, false);
      if (typeof x === "number") return ok(x.toString(), true);
      if (typeof x === "bigint") return ok(x.toString(), true);
      if (typeof x === "boolean") return ok(x.toString(), true);
      if (typeof x === "symbol") return ok(x.description ?? x.toString(), true);
      if (x instanceof Date) return ok(x.toISOString(), true);
      return err(x, "Expected string");
    },
    {
      outputSchema: { type: "string" },
      inputSchema: JsonSchemaNever,
    },
  );

/**
 * Parse JSON
 */
const fromJson = <G extends Guard<unknown, any>,>(guard: G): Guard<Infer<G>, string> =>
  string()
    .map(x => {
      try {
        return ok(JSON.parse(x), true);
      } catch (e) {
        if (object({ message: string() }).is(e)) {
          return err(x, e.message);
        }
        return err(x, "Could not parse as JSON");
      }
    })
    .map(guard as Guard<Infer<G>, string>);

/**
 * Serialize a value as JSON
 */
const intoJson = () =>
  new Guard<string, unknown>(x => {
    try {
      return ok(string().parse(JSON.stringify(x)), true);
    } catch (_e) {
      return err(x, "Could not serialize as JSON");
    }
  });

/**
 * Regexp group extraction
 */
const fromRegex = (re: string | RegExp): Guard<RegExpExecArray, string> => {
  const normalizedRe = typeof re === "string" ? new RegExp(re) : re;
  return string()
    .map(x => {
      const reCopy = new RegExp(normalizedRe.source, normalizedRe.flags);
      const match = reCopy.exec(x);
      if (!match) {
        return err(x, "Expected string matching regex");
      }

      return ok(match, true);
    })
    .withSchema({
      inputSchema: { type: "string", pattern: normalizedRe.source },
    });
};

/**
 * Parse a date from a string, number, or Date object
 */
const intoDate = () =>
  oneOf(number(), bigint(), string(), instanceOf(Date)).map(
    x => {
      if (x instanceof Date) return ok(x, false);
      const d = new Date(typeof x === "bigint" ? Number(x) : x);
      if (Number.isNaN(d.getTime())) {
        return err(x, "Invalid date");
      }
      return ok(d, true);
    },
    { type: "string", pattern: ".*" },
  );

export default {
  Guard,
  ParseError,
  ok,
  err,
  JsonSchemaNever,
  unknown,
  nul,
  undef,
  number,
  string,
  regex,
  boolean,
  bigint,
  symbol,
  int,
  finite,
  nan,
  literal,
  object,
  record,
  array,
  arrayNonEmpty,
  allOf,
  oneOf,
  tuple,
  instanceOf,
  intoNumber,
  intoString,
  fromJson,
  intoJson,
  fromRegex,
  intoDate,
  set,
  map,
};
