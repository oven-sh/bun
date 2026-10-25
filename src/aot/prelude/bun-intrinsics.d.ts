declare module "bun" {
  import * as BunModule from "bun";

  type int32 = number & { readonly "bun.int32"?: true };

  namespace Schema {
    interface Issue {
      path: (string | number)[];
      code: string;
      expected: string;
      received: string;
      message: string;
    }
    // Not an interface that extends `TypeError`: a subtype in a declaration file makes a built-in class's type expected, not proven.
    type Error = TypeError & { issues: Issue[] };
    type Int = { readonly "bun.int"?: true };
    type Min<N extends number> = { readonly "bun.min"?: N };
    type Max<N extends number> = { readonly "bun.max"?: N };
    type Above<N extends number> = { readonly "bun.above"?: N };
    type Below<N extends number> = { readonly "bun.below"?: N };
    type MultipleOf<N extends number> = { readonly "bun.multipleOf"?: N };
    type MinLength<N extends number> = { readonly "bun.minLength"?: N };
    type MaxLength<N extends number> = { readonly "bun.maxLength"?: N };
    type MinItems<N extends number> = { readonly "bun.minItems"?: N };
    type MaxItems<N extends number> = { readonly "bun.maxItems"?: N };
    type Pattern<P extends string, Flags extends "" | "u" = ""> = { readonly "bun.pattern"?: [P, Flags] };
    type Format<
      S extends
        | "email"
        | "uuid"
        | "ipv4"
        | "ipv6"
        | "date"
        | "date-time"
        | "url"
        | "time"
        | "duration"
        | "hostname"
        | "uri"
        | "uri-reference"
        | "regex"
        | "json-pointer"
        | "relative-json-pointer",
    > = {
      readonly "bun.format"?: S;
    };
    type UniqueItems = { readonly "bun.uniqueItems"?: true };
    type Contains<T, Min extends number = 1, Max extends number = never> = { readonly "bun.contains"?: [T, Min, Max] };
    type Not<T> = { readonly "bun.not"?: [T] };
    type If<C, T = unknown, E = unknown> = { readonly "bun.if"?: [C, T, E] };
    type OneOf<A extends unknown[]> = { readonly "bun.oneOf"?: A };
    type AllOf<A extends unknown[]> = { readonly "bun.allOf"?: A };
    type PatternProperties<P extends Record<string, unknown>, Others = unknown> = {
      readonly "bun.patternProperties"?: [P, Others];
    };
    type PropertyNames<T> = { readonly "bun.propertyNames"?: [T] };
    type MinProperties<N extends number> = { readonly "bun.minProperties"?: N };
    type MaxProperties<N extends number> = { readonly "bun.maxProperties"?: N };
    type DependentRequired<D extends Record<string, string[]>> = { readonly "bun.dependentRequired"?: D };
    type DependentSchemas<D extends Record<string, unknown>> = { readonly "bun.dependentSchemas"?: D };
    type Refused<K extends string> = { readonly "bun.refused"?: K };
    type Message<S extends string> = { readonly "bun.message"?: S };
    type Default<V extends string | number | boolean | null> = { readonly "bun.default"?: V };
    type Strict = { readonly "bun.strict"?: true };
    type DeepStrict = { readonly "bun.strict"?: "deep" };

    /** The type of the values that a JSON Schema accepts. The schema is a literal type: `typeof schema` of a schema written `as const`. `Documents` is the type of the `schemas` option. */
    type FromJSONSchema<S, Documents = {}> = JSONSchema.Whole<S, Documents>;

    namespace JSONSchema {
      type Annotation =
        | "$schema"
        | "$id"
        | "$comment"
        | "$defs"
        | "definitions"
        | "title"
        | "description"
        | "default"
        | "examples"
        | "deprecated"
        | "readOnly"
        | "writeOnly"
        | "contentEncoding"
        | "contentMediaType"
        | "contentSchema"
        | `x-${string}`;

      type Numbers = "minimum" | "maximum" | "exclusiveMinimum" | "exclusiveMaximum" | "multipleOf";
      type Counts =
        | "minLength"
        | "maxLength"
        | "minItems"
        | "maxItems"
        | "minContains"
        | "maxContains"
        | "minProperties"
        | "maxProperties";
      type Lists = "enum" | "required" | "prefixItems";
      type Alternatives = "allOf" | "anyOf" | "oneOf";
      type Tables = "properties" | "patternProperties" | "dependentRequired" | "dependentSchemas" | "dependencies";
      type InPlace = Alternatives | "not" | "if" | "then" | "else" | "$ref";
      type TableOfSchemas =
        "$defs" | "definitions" | "properties" | "patternProperties" | "dependentSchemas" | "dependencies";
      type ListOfSchemas = Alternatives | "prefixItems";
      type OneSchema =
        | "items"
        | "additionalItems"
        | "additionalProperties"
        | "contains"
        | "propertyNames"
        | "not"
        | "if"
        | "then"
        | "else"
        | "contentSchema";
      type Keyword =
        | Numbers
        | Counts
        | Lists
        | Tables
        | InPlace
        | "type"
        | "const"
        | "pattern"
        | "format"
        | "items"
        | "additionalItems"
        | "uniqueItems"
        | "contains"
        | "additionalProperties"
        | "propertyNames";

      type Kind = "null" | "boolean" | "number" | "integer" | "string" | "array" | "object";
      type CheckedFormat =
        | "date-time"
        | "date"
        | "time"
        | "duration"
        | "email"
        | "hostname"
        | "ipv4"
        | "ipv6"
        | "uri"
        | "uri-reference"
        | "uuid"
        | "regex"
        | "json-pointer"
        | "relative-json-pointer";
      type Draft7 =
        | "http://json-schema.org/draft-07/schema"
        | "http://json-schema.org/draft-07/schema#"
        | "http://json-schema.org/draft-06/schema"
        | "http://json-schema.org/draft-06/schema#";
      type Draft2020 = "https://json-schema.org/draft/2020-12/schema" | "https://json-schema.org/draft/2020-12/schema#";

      type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
      type IsUnion<T, Whole = T> = T extends unknown ? ([Whole] extends [T] ? false : true) : never;
      type IsTuple<A> =
        IsUnion<A> extends true
          ? false
          : A extends readonly unknown[]
            ? number extends A["length"]
              ? false
              : true
            : false;
      type IsOneOf<V, Base> = [V] extends [Base]
        ? [Base] extends [V]
          ? false
          : IsUnion<V> extends true
            ? false
            : true
        : false;
      type IsNumber<V> =
        IsOneOf<V, number> extends true ? (`${V & number}` extends `${string}Infinity` | "NaN" ? false : true) : false;
      type HasTenCharacters<T extends string> =
        T extends `${infer _1}${infer _2}${infer _3}${infer _4}${infer _5}${infer _6}${infer _7}${infer _8}${infer _9}${infer _10}${string}`
          ? true
          : false;
      /** A whole number from 0 to 999,999,999. */
      type IsCount<V> =
        IsNumber<V> extends true
          ? `${V & number}` extends `-${string}` | `${string}.${string}` | `${string}e${string}`
            ? false
            : HasTenCharacters<`${V & number}`> extends true
              ? false
              : true
          : false;
      type IsNames<V> =
        IsTuple<V> extends true
          ? V extends readonly string[]
            ? string extends V[number]
              ? false
              : true
            : false
          : false;
      type IsTable<V> =
        IsUnion<V> extends true
          ? false
          : V extends readonly unknown[]
            ? false
            : V extends object
              ? string extends keyof V
                ? false
                : true
              : false;
      /** Every part of the value is a literal type. A widened one, such as `string`, says less than the schema does. */
      type IsConstant<V> =
        IsUnion<V> extends true
          ? false
          : V extends null | boolean
            ? true
            : V extends string
              ? string extends V
                ? false
                : true
              : V extends number
                ? IsNumber<V>
                : V extends readonly unknown[]
                  ? IsTuple<V> extends true
                    ? false extends { [I in keyof V]: IsConstant<V[I]> }[number]
                      ? false
                      : true
                    : false
                  : V extends object
                    ? false extends { [K in keyof V]: IsConstant<V[K]> }[keyof V]
                      ? false
                      : true
                    : false;
      type Name<K> = K extends string | number ? `${K}` : "symbol";
      type Asserting<S> = Exclude<keyof S, Annotation>;
      type Flat<T> = { [K in keyof T]: T[K] };
      type Mutable<V> = V extends readonly unknown[] | object ? { -readonly [K in keyof V]: Mutable<V[K]> } : V;

      type IsWellFormed<K, V> = K extends "multipleOf"
        ? IsNumber<V> extends true
          ? `${V & number}` extends `-${string}` | "0"
            ? false
            : true
          : false
        : K extends Numbers
          ? IsNumber<V>
          : K extends Counts
            ? IsCount<V>
            : K extends "pattern" | "$ref"
              ? IsOneOf<V, string>
              : K extends "$id"
                ? IsOneOf<V, string>
                : K extends "$schema"
                  ? IsOneOf<V, Draft7 | Draft2020>
                  : K extends "format"
                    ? IsOneOf<V, CheckedFormat>
                    : K extends "uniqueItems"
                      ? IsOneOf<V, boolean>
                      : K extends "additionalProperties" | "items" | "additionalItems"
                        ? Same<V, boolean> extends true
                          ? false
                          : true
                        : K extends "const"
                          ? IsConstant<V>
                          : K extends "enum"
                            ? V extends readonly unknown[]
                              ? IsConstant<V>
                              : false
                            : K extends "required"
                              ? IsNames<V>
                              : K extends Alternatives | "prefixItems"
                                ? V extends readonly []
                                  ? false
                                  : IsTuple<V>
                                : K extends Lists
                                  ? IsTuple<V>
                                  : K extends "dependentRequired"
                                    ? IsTable<V> extends true
                                      ? false extends { [N in keyof V]: IsNames<V[N]> }[keyof V]
                                        ? false
                                        : true
                                      : false
                                    : K extends "dependencies"
                                      ? IsTable<V> extends true
                                        ? false extends {
                                            [N in keyof V]: V[N] extends readonly unknown[] ? IsNames<V[N]> : true;
                                          }[keyof V]
                                          ? false
                                          : true
                                        : false
                                      : K extends Tables | TableOfSchemas
                                        ? IsTable<V>
                                        : K extends "type"
                                          ? V extends readonly unknown[]
                                            ? V extends readonly []
                                              ? false
                                              : IsTuple<V> extends true
                                                ? [V[number]] extends [Kind]
                                                  ? true
                                                  : false
                                                : false
                                            : IsOneOf<V, Kind>
                                          : true;

      /** A union says less than the schema does. */
      type Malformed<S> = {
        [K in keyof S]-?: K extends Keyword | TableOfSchemas | "$id" | "$schema"
          ? IsUnion<S[K]> extends true
            ? Name<K>
            : IsWellFormed<K, S[K]> extends true
              ? never
              : Name<K>
          : never;
      }[keyof S];

      /** The keywords of one schema that cannot be translated. None: `never`. */
      type Fault<S, R, D> =
        | Name<Exclude<keyof S, Keyword | Annotation>>
        | Malformed<S>
        | (S extends Required<S> ? never : "schema")
        | ([keyof S] extends [never] ? ([string] extends [S] ? never : "schema") : never)
        | (S extends { readonly $id: unknown } ? (Same<S, R> extends true ? never : "$id") : never)
        | (S extends { readonly $schema: unknown } ? (Same<S, R> extends true ? never : "$schema") : never)
        | (S extends { readonly then: unknown } ? (S extends { readonly if: unknown } ? never : "then") : never)
        | (S extends { readonly else: unknown } ? (S extends { readonly if: unknown } ? never : "else") : never)
        | (S extends { readonly minContains: unknown }
            ? S extends { readonly contains: unknown }
              ? never
              : "minContains"
            : never)
        | (S extends { readonly maxContains: unknown }
            ? S extends { readonly contains: unknown }
              ? never
              : "maxContains"
            : never)
        | (S extends { readonly additionalItems: unknown }
            ? S extends { readonly items: readonly unknown[] }
              ? never
              : "additionalItems"
            : never)
        | (S extends { readonly items: readonly unknown[] }
            ? S extends { readonly prefixItems: unknown }
              ? "items"
              : IsTuple<S["items"]> extends true
                ? never
                : "items"
            : never)
        | (S extends { readonly const: unknown; readonly enum: unknown } ? "enum" : never)
        | (S extends { readonly $ref: infer P } ? (ComesBack<P, R, D, never> extends false ? never : "$ref") : never)
        | (S extends { readonly patternProperties: unknown }
            ? IsOpen<Others<S>> extends true
              ? never
              : [Exclude<RequiredKeys<S>, keyof Properties<S>>] extends [never]
                ? never
                : "patternProperties"
            : never)
        | (R extends { readonly $schema: Draft7 }
            ? | Extract<
                  keyof S,
                  "prefixItems" | "minContains" | "maxContains" | "dependentRequired" | "dependentSchemas"
                >
              | (S extends { readonly $ref: unknown } ? ([Asserting<S>] extends ["$ref"] ? never : "$ref") : never)
            : never)
        | (R extends { readonly $schema: Draft2020 }
            ? | Extract<keyof S, "additionalItems" | "dependencies">
              | (S extends { readonly items: readonly unknown[] } ? "items" : never)
            : never);

      type Text<S> = string &
        (S extends { readonly minLength: infer N extends number } ? MinLength<N> : unknown) &
        (S extends { readonly maxLength: infer N extends number } ? MaxLength<N> : unknown) &
        (S extends { readonly pattern: infer P extends string } ? Pattern<P, "u"> : unknown) &
        (S extends { readonly format: infer F extends CheckedFormat } ? Format<F> : unknown);

      type Numeric<S> = number &
        (S extends { readonly minimum: infer N extends number } ? Min<N> : unknown) &
        (S extends { readonly maximum: infer N extends number } ? Max<N> : unknown) &
        (S extends { readonly exclusiveMinimum: infer N extends number } ? Above<N> : unknown) &
        (S extends { readonly exclusiveMaximum: infer N extends number } ? Below<N> : unknown) &
        (S extends { readonly multipleOf: infer N extends number } ? MultipleOf<N> : unknown);

      type Each<A extends readonly unknown[], R, D, Seen> = { -readonly [I in keyof A]: From<A[I], R, D, Seen> };
      type EachOptional<A extends readonly unknown[], R, D, Seen> = {
        -readonly [I in keyof A]?: From<A[I], R, D, Seen>;
      };

      /** A schema for a position says nothing about an array that ends before it. `minItems` makes the first elements required. */
      type Positions<
        P extends readonly unknown[],
        N,
        R,
        D,
        Seen,
        Done extends unknown[] = [],
      > = Done["length"] extends N
        ? [...Done, ...EachOptional<P, R, D, Seen>]
        : P extends readonly [infer First, ...infer Later]
          ? Positions<Later, N, R, D, Seen, [...Done, From<First, R, D, Seen>]>
          : Done;

      type Positional<P extends readonly unknown[], Beyond, S, R, D, Seen> = Beyond extends false
        ? Positions<P, S extends { readonly minItems: infer N } ? N : 0, R, D, Seen>
        : [
            ...Positions<P, S extends { readonly minItems: infer N } ? N : 0, R, D, Seen>,
            ...From<Beyond, R, D, Seen>[],
          ];

      type Elements<S, R, D, Seen> = S extends { readonly prefixItems: infer P extends readonly unknown[] }
        ? Positional<P, S extends { readonly items: infer I } ? I : true, S, R, D, Seen>
        : S extends { readonly items: infer P extends readonly unknown[] }
          ? Positional<P, S extends { readonly additionalItems: infer I } ? I : true, S, R, D, Seen>
          : S extends { readonly items: infer I }
            ? From<I, R, D>[]
            : unknown[];

      type List<S, R, D, Seen> = Elements<S, R, D, Seen> &
        (S extends { readonly minItems: infer N extends number } ? MinItems<N> : unknown) &
        (S extends { readonly maxItems: infer N extends number } ? MaxItems<N> : unknown) &
        (S extends { readonly uniqueItems: true } ? UniqueItems : unknown) &
        (S extends { readonly contains: infer C }
          ? Contains<
              From<C, R, D, Seen>,
              S extends { readonly minContains: infer N extends number } ? N : 1,
              S extends { readonly maxContains: infer N extends number } ? N : never
            >
          : unknown);

      type Properties<S> = S extends { readonly properties: infer P } ? P : {};
      type RequiredKeys<S> = S extends { readonly required: infer Q extends readonly string[] } ? Q[number] : never;
      type Others<S> = S extends { readonly additionalProperties: infer A } ? A : true;
      type IsOpen<A> = A extends boolean
        ? A
        : A extends object
          ? [Asserting<A>] extends [never]
            ? true
            : false
          : false;

      type Members<P, Q, A, R, D> = Flat<
        { -readonly [K in keyof P as K extends Q ? K : never]: From<P[K], R, D> } & {
          -readonly [K in keyof P as K extends Q ? never : K]?: From<P[K], R, D>;
        } & { [K in Exclude<Q, keyof P> & string]: From<A, R, D> } & (IsOpen<A> extends true
            ? {}
            : A extends false
              ? {}
              : { [K in string]: From<A, R, D> })
      >;

      type NamesOf<L> = L extends readonly string[] ? [...L] : [];
      type Table<T, K extends keyof T, R, D, Seen> = { -readonly [N in K]: From<T[N], R, D, Seen> };
      type ListKeys<T> = { [K in keyof T]: T[K] extends readonly unknown[] ? K : never }[keyof T];
      /** A table without a key says nothing, and gives no rule. */
      type HasPatterns<S> = S extends { readonly patternProperties: infer T }
        ? [keyof T] extends [never]
          ? false
          : true
        : false;
      type Matching<T, A, R, D, Seen> = PatternProperties<Table<T, keyof T, R, D, never>, From<A, R, D, Seen>>;
      type Needing<T, K extends keyof T> = [K] extends [never]
        ? unknown
        : DependentRequired<{ -readonly [N in K]: NamesOf<T[N]> }>;
      type Implying<T, K extends keyof T, R, D, Seen> = [K] extends [never]
        ? unknown
        : DependentSchemas<Table<T, K, R, D, Seen>>;

      /** Beside `patternProperties` the type has no index signature: a key that matches is not held to `additionalProperties`. */
      type Fields<S, R, D, Seen> = Members<
        Properties<S>,
        RequiredKeys<S>,
        HasPatterns<S> extends true ? true : Others<S>,
        R,
        D
      > &
        (Others<S> extends false ? Strict : unknown) &
        (HasPatterns<S> extends true
          ? S extends { readonly patternProperties: infer T }
            ? Matching<T, Others<S>, R, D, Seen>
            : never
          : unknown) &
        (S extends { readonly propertyNames: infer N } ? PropertyNames<From<N, R, D, Seen>> : unknown) &
        (S extends { readonly minProperties: infer N extends number } ? MinProperties<N> : unknown) &
        (S extends { readonly maxProperties: infer N extends number } ? MaxProperties<N> : unknown) &
        (S extends { readonly dependentRequired: infer T } ? Needing<T, keyof T> : unknown) &
        (S extends { readonly dependentSchemas: infer T } ? Implying<T, keyof T, R, D, Seen> : unknown) &
        (S extends { readonly dependencies: infer T }
          ? Needing<T, ListKeys<T>> & Implying<T, Exclude<keyof T, ListKeys<T>>, R, D, Seen>
          : unknown);

      type Kinds<S> = S extends { readonly type: infer K }
        ? K extends readonly unknown[]
          ? K[number]
          : K
        : Exclude<Kind, "integer">;

      /** `null` is not here: no rule can stand beside it in an intersection. {@link TakesNull} answers for it. */
      type OfKind<K, S, R, D, Seen> = K extends "string"
        ? Text<S>
        : K extends "number"
          ? Numeric<S>
          : K extends "integer"
            ? Numeric<S> & Int
            : K extends "boolean"
              ? boolean
              : K extends "array"
                ? List<S, R, D, Seen>
                : K extends "object"
                  ? Fields<S, R, D, Seen>
                  : never;

      type Constant<V, K> = V extends null
        ? "null" extends K
          ? V
          : never
        : V extends boolean
          ? "boolean" extends K
            ? V
            : never
          : V extends number
            ? "number" extends K
              ? V
              : "integer" extends K
                ? V & Int
                : never
            : V extends string
              ? "string" extends K
                ? V
                : never
              : V extends readonly unknown[]
                ? "array" extends K
                  ? Mutable<V> & DeepStrict
                  : never
                : V extends object
                  ? "object" extends K
                    ? Mutable<V> & DeepStrict
                    : never
                  : never;

      type Constants<V, S, R, D, Seen> = Constant<V, Kinds<S>> &
        ([Exclude<Asserting<S>, InPlace | "const" | "enum" | "type">] extends [never]
          ? unknown
          : AllOf<[OfKind<Kinds<S>, S, R, D, Seen>]>);

      type Host<S, R, D, Seen> = S extends { readonly const: infer C }
        ? Constants<C, S, R, D, Seen>
        : S extends { readonly enum: infer E extends readonly unknown[] }
          ? Constants<E[number], S, R, D, Seen>
          : OfKind<Kinds<S>, S, R, D, Seen>;

      type Coarse<K> = K extends "integer" ? "number" : K;
      type Literals<S> = S extends { readonly const: infer C }
        ? C
        : S extends { readonly enum: infer E extends readonly unknown[] }
          ? E[number]
          : unknown;
      type Tags<S> = { [K in RequiredKeys<S> & keyof Properties<S>]: Literals<Properties<S>[K]> };
      type TagsExclude<A, B> = true extends {
        [K in keyof A & keyof B]: [A[K] & B[K]] extends [never] ? true : false;
      }[keyof A & keyof B]
        ? true
        : false;
      /** No value is valid under both schemas: by their constants, by their types, or by a constant member that both objects require. */
      type Excludes<A, B> = [Literals<A> & Literals<B>] extends [never]
        ? true
        : [Coarse<Kinds<A>> & Coarse<Kinds<B>>] extends [never]
          ? true
          : [Kinds<A> | Kinds<B>] extends ["object"]
            ? TagsExclude<Tags<A>, Tags<B>>
            : false;
      type ExcludesEach<T, A, R, D, Seen> = A extends readonly [infer First, ...infer Rest]
        ? Excludes<T, Followed<First, R, D, Seen>> extends true
          ? ExcludesEach<T, Rest, R, D, Seen>
          : false
        : true;
      type Disjoint<A, R, D, Seen> = A extends readonly [infer First, ...infer Rest]
        ? ExcludesEach<Followed<First, R, D, Seen>, Rest, R, D, Seen> extends true
          ? Disjoint<Rest, R, D, Seen>
          : false
        : true;

      type Applied<S, R, D, Seen> = (S extends { readonly not: infer N } ? Not<From<N, R, D, Seen>> : unknown) &
        (S extends { readonly if: infer C }
          ? If<
              From<C, R, D, Seen>,
              S extends { readonly then: infer T } ? From<T, R, D, Seen> : unknown,
              S extends { readonly else: infer E } ? From<E, R, D, Seen> : unknown
            >
          : unknown) &
        (S extends { readonly oneOf: infer A extends readonly unknown[] }
          ? Disjoint<A, R, D, Seen> extends true
            ? AllOf<[Each<A, R, D, Seen>[number]]>
            : OneOf<Each<A, R, D, Seen>>
          : unknown) &
        (S extends { readonly anyOf: infer A extends readonly unknown[] }
          ? AllOf<[Each<A, R, D, Seen>[number]]>
          : unknown) &
        (S extends { readonly allOf: infer A extends readonly unknown[] } ? AllOf<Each<A, R, D, Seen>> : unknown) &
        (S extends { readonly $ref: infer P } ? AllOf<[Ref<P, R, D, Seen>]> : unknown);

      type Escapes = {
        "20": " ";
        "22": '"';
        "23": "#";
        "25": "%";
        "3C": "<";
        "3c": "<";
        "3E": ">";
        "3e": ">";
        "5B": "[";
        "5b": "[";
        "5C": "\\";
        "5c": "\\";
        "5D": "]";
        "5d": "]";
        "5E": "^";
        "5e": "^";
        "60": "`";
        "7B": "{";
        "7b": "{";
        "7C": "|";
        "7c": "|";
        "7D": "}";
        "7d": "}";
      };
      /** `never`: an escape that is not in the table. */
      type Decoded<T extends string> = T extends `${infer A}%${infer High}${infer Low}${infer B}`
        ? `${High}${Low}` extends infer Code extends keyof Escapes
          ? `${A}${Escapes[Code]}${Decoded<B>}`
          : never
        : T extends `${string}%${string}`
          ? never
          : T;
      type Unescaped<T extends string> = T extends `${infer A}~1${infer B}`
        ? `${Unescaped<A>}/${Unescaped<B>}`
        : T extends `${infer A}~0${infer B}`
          ? `${A}~${Unescaped<B>}`
          : T;
      type Child<T, Segment extends string> = [Unescaped<Decoded<Segment>>] extends [infer K]
        ? [K] extends [never]
          ? false
          : K extends keyof T
            ? [T[K]]
            : false
        : false;
      /** What stands under a key: `"schema"`, `"table"`, `"list"`, or `false` for what is no place of a schema. */
      type PlaceUnder<Place, K, V> = Place extends "schema"
        ? K extends TableOfSchemas
          ? "table"
          : K extends ListOfSchemas
            ? "list"
            : K extends OneSchema
              ? V extends readonly unknown[]
                ? "list"
                : "schema"
              : false
        : V extends readonly unknown[]
          ? false
          : Place extends "list"
            ? K extends `${number}`
              ? "schema"
              : false
            : "schema";
      type Stepped<T, Head extends string, Tail, Place> =
        Child<T, Head> extends [infer C]
          ? PlaceUnder<Place, Unescaped<Decoded<Head>>, C> extends infer Next
            ? Next extends false
              ? false
              : Pointed<C, Tail, Next>
            : false
          : false;
      /** `[the schema at the JSON Pointer]`, or `false`. */
      type Pointed<T, F, Place = "schema"> = F extends ""
        ? Place extends "schema"
          ? [T]
          : false
        : F extends `/${infer Head}/${infer Tail}`
          ? Stepped<T, Head, `/${Tail}`, Place>
          : F extends `/${infer Head}`
            ? Stepped<T, Head, "", Place>
            : false;
      type OnlyOne<T> = [T] extends [never] ? false : IsUnion<T> extends true ? false : T;
      type DocumentAt<U, R, D> = R extends { readonly $id: U }
        ? R
        : D extends readonly unknown[]
          ? OnlyOne<Extract<D[number], { readonly $id: U }>>
          : U extends keyof D
            ? D[U]
            : false;
      type PointedIn<T, F> = T extends false ? false : Pointed<T, F> extends [infer Found] ? [Found, T] : false;
      /** `[schema, the root of its document]`, or `false`. Another document is named by its whole URI. */
      type Resolved<P, R, D> = P extends `#${infer F}`
        ? PointedIn<R, F>
        : P extends `${string}:${string}`
          ? P extends `${infer U}#${infer F}`
            ? PointedIn<DocumentAt<U, R, D>, F>
            : PointedIn<DocumentAt<P, R, D>, "">
          : false;
      /** `Seen`: the references that were followed to get here without going into the value. One of them again would never end. */
      type Ref<P, R, D, Seen> = [P] extends [Seen]
        ? Refused<"$ref">
        : Resolved<P, R, D> extends [infer T, infer Root]
          ? From<T, Root, D, Seen | P>
          : Refused<"$ref">;

      type AnyComesBack<A, R, D, Seen> = true extends { [K in keyof A]: LeadsBack<A[K], R, D, Seen> }[keyof A]
        ? true
        : false;
      /** Whether a reference of `Seen` is met again in the parts of the schema that are translated together with it. */
      type LeadsBack<S, R, D, Seen> = S extends readonly unknown[]
        ? false
        : S extends object
          ? true extends {
              [K in keyof S]: K extends "$ref"
                ? ComesBack<S[K], R, D, Seen>
                : K extends ListOfSchemas | "dependentSchemas" | "dependencies"
                  ? AnyComesBack<S[K], R, D, Seen>
                  : K extends "items"
                    ? S[K] extends readonly unknown[]
                      ? AnyComesBack<S[K], R, D, Seen>
                      : S extends { readonly prefixItems: unknown }
                        ? LeadsBack<S[K], R, D, Seen>
                        : false
                    : K extends "additionalProperties"
                      ? HasPatterns<S> extends true
                        ? LeadsBack<S[K], R, D, Seen>
                        : false
                      : K extends Exclude<OneSchema, "contentSchema">
                        ? LeadsBack<S[K], R, D, Seen>
                        : false;
            }[keyof S]
            ? true
            : false
          : false;
      /** Also `true` for a reference that leads nowhere. */
      type ComesBack<P, R, D, Seen> = [P] extends [Seen]
        ? true
        : Resolved<P, R, D> extends [infer T, infer Root]
          ? LeadsBack<T, Root, D, Seen | P>
          : true;

      type Taking<A, R, D, Seen> = A extends readonly [infer First, ...infer Rest]
        ? TakesNull<First, R, D, Seen> extends true
          ? [1, ...Taking<Rest, R, D, Seen>]
          : Taking<Rest, R, D, Seen>
        : [];
      /** Whether the schema accepts `null`. */
      type TakesNull<S, R, D, Seen> = [S] extends [boolean]
        ? [boolean] extends [S]
          ? false
          : S
        : false extends
              | (S extends object ? true : false)
              | ([Fault<S, R, D>] extends [never] ? true : false)
              | ("null" extends Kinds<S> ? true : false)
              | (S extends { readonly const: infer C } ? ([C] extends [null] ? true : false) : true)
              | (S extends { readonly enum: infer E extends readonly unknown[] }
                  ? null extends E[number]
                    ? true
                    : false
                  : true)
              | (S extends { readonly not: infer N } ? (TakesNull<N, R, D, Seen> extends true ? false : true) : true)
              | (S extends { readonly if: infer C }
                  ? TakesNull<C, R, D, Seen> extends true
                    ? S extends { readonly then: infer T }
                      ? TakesNull<T, R, D, Seen>
                      : true
                    : S extends { readonly else: infer E }
                      ? TakesNull<E, R, D, Seen>
                      : true
                  : true)
              | (S extends { readonly allOf: infer A extends readonly unknown[] }
                  ? Taking<A, R, D, Seen>["length"] extends A["length"]
                    ? true
                    : false
                  : true)
              | (S extends { readonly anyOf: infer A }
                  ? Taking<A, R, D, Seen>["length"] extends 0
                    ? false
                    : true
                  : true)
              | (S extends { readonly oneOf: infer A }
                  ? Taking<A, R, D, Seen>["length"] extends 1
                    ? true
                    : false
                  : true)
              | (S extends { readonly $ref: infer P }
                  ? [P] extends [Seen]
                    ? false
                    : Resolved<P, R, D> extends [infer T, infer Root]
                      ? TakesNull<T, Root, D, Seen | P>
                      : false
                  : true)
          ? false
          : true;

      type General<S, R, D, Seen> =
        (Host<S, R, D, Seen> & Applied<S, R, D, Seen>) | (TakesNull<S, R, D, Seen> extends true ? null : never);

      /** The schema that a schema with nothing but `$ref` stands for, if it is in the same document. */
      type Followed<S, R, D, Seen> = S extends { readonly $ref: infer P }
        ? [P] extends [Seen]
          ? false
          : [Asserting<S>] extends ["$ref"]
            ? Resolved<P, R, D> extends [infer T, infer Root]
              ? Same<Root, R> extends true
                ? Followed<T, R, D, Seen | P>
                : false
              : false
            : false
        : S;
      type IsOpenObject<S, R, D, IsObject> = [Exclude<Asserting<S>, "type" | "properties" | "required">] extends [never]
        ? [Fault<S, R, D>] extends [never]
          ? S extends { readonly type: infer K }
            ? Same<K, "object">
            : IsObject
          : false
        : false;
      /** Objects that allow other properties and declare none twice are one object. Anything else: `false`. */
      type Merged<A, R, D, Seen, P, Q, IsObject> = A extends readonly [infer First, ...infer Rest]
        ? Followed<First, R, D, Seen> extends infer T
          ? IsOpenObject<T, R, D, IsObject> extends true
            ? [keyof Properties<T> & keyof P] extends [never]
              ? Merged<Rest, R, D, Seen, P & Properties<T>, Q | RequiredKeys<T>, IsObject>
              : false
            : false
          : false
        : Members<P, Q, true, R, D>;
      type Or<T, Otherwise> = [T] extends [false] ? Otherwise : T;

      type Translated<S, R, D, Seen, K = Asserting<S>> = [K] extends [never]
        ? unknown
        : [K] extends ["$ref"]
          ? S extends { readonly $ref: infer P }
            ? Ref<P, R, D, Seen>
            : never
          : [K] extends ["anyOf"]
            ? S extends { readonly anyOf: infer A extends readonly unknown[] }
              ? Each<A, R, D, Seen>[number]
              : never
            : [K] extends ["oneOf"]
              ? S extends { readonly oneOf: infer A extends readonly unknown[] }
                ? Disjoint<A, R, D, Seen> extends true
                  ? Each<A, R, D, Seen>[number]
                  : General<S, R, D, Seen>
                : never
              : [K] extends ["allOf"]
                ? S extends { readonly allOf: readonly [infer Only] }
                  ? From<Only, R, D, Seen>
                  : S extends { readonly allOf: infer A }
                    ? Or<Merged<A, R, D, Seen, {}, never, false>, General<S, R, D, Seen>>
                    : never
                : [K] extends ["allOf" | "type" | "properties" | "required"]
                  ? S extends { readonly allOf: infer A; readonly type: "object" }
                    ? Or<Merged<A, R, D, Seen, Properties<S>, RequiredKeys<S>, true>, General<S, R, D, Seen>>
                    : General<S, R, D, Seen>
                  : General<S, R, D, Seen>;

      type From<S, R, Documents = {}, Seen = never> = [S] extends [never]
        ? Refused<"schema">
        : [S] extends [boolean]
          ? [boolean] extends [S]
            ? Refused<"schema">
            : S extends false
              ? never
              : unknown
          : IsUnion<S> extends true
            ? Refused<"schema">
            : S extends readonly unknown[]
              ? Refused<"schema">
              : S extends object
                ? Fault<S, R, Documents> extends infer F
                  ? [F] extends [never]
                    ? Translated<S, R, Documents, Seen>
                    : F extends string
                      ? Refused<F>
                      : never
                  : never
                : Refused<"schema">;

      type Tildes<T extends string> = T extends `${infer A}~${infer B}` ? `${A}~0${Tildes<B>}` : T;
      type Slashes<T extends string> = T extends `${infer A}/${infer B}` ? `${A}~1${Slashes<B>}` : T;
      type InList<A, At extends string> =
        IsTuple<A> extends true ? { [I in keyof A]: [A[I], `${At}/${I & string}`] }[keyof A & number] : never;
      type InTable<T, At extends string> =
        IsTable<T> extends true ? { [K in keyof T]-?: [T[K], `${At}/${Slashes<Tildes<Name<K>>>}`] }[keyof T] : never;
      /** `[schema, pointer]` of every schema that one of `Places` holds. */
      type Within<Places> = Places extends [infer S, infer At extends string]
        ? S extends readonly unknown[]
          ? never
          : S extends object
            ? {
                [K in keyof S]-?: K extends "dependencies"
                  ? InTable<Omit<S[K], ListKeys<S[K]>>, `${At}/${K}`>
                  : K extends TableOfSchemas
                    ? InTable<S[K], `${At}/${K}`>
                    : K extends ListOfSchemas
                      ? InList<S[K], `${At}/${K}`>
                      : K extends OneSchema
                        ? K extends "items"
                          ? S[K] extends readonly unknown[]
                            ? InList<S[K], `${At}/${K}`>
                            : [S[K], `${At}/${K}`]
                          : [S[K], `${At}/${K}`]
                        : never;
              }[keyof S]
            : never
        : never;
      type FaultsOf<Places, R, D> = Places extends [infer S, infer At extends string]
        ? [S] extends [never]
          ? `schema at ${At}`
          : [S] extends [boolean]
            ? [boolean] extends [S]
              ? `schema at ${At}`
              : never
            : IsUnion<S> extends true
              ? `schema at ${At}`
              : IsTable<S> extends true
                ? `${Fault<S, R, D>} at ${At}` | (S extends { readonly $ref: infer P } ? Elsewhere<P, R> : never)
                : `schema at ${At}`
        : never;
      /** Every fault of the schemas of `Places` and of the schemas within them, used or not, each as `keyword at pointer`, and {@link Elsewhere}. */
      type Faults<Places, R, D, Found = never> = [Places] extends [never]
        ? Found
        : Faults<Within<Places>, R, D, Found | FaultsOf<Places, R, D>>;
      /** `[the URI]` of the other document that a reference names. */
      type Elsewhere<P, R> = P extends `#${string}`
        ? never
        : (P extends `${infer U}#${string}` ? U : P) extends infer U
          ? R extends { readonly $id: U }
            ? never
            : [U]
          : never;
      /** In a table of documents the key is the URI, and an `$id` must repeat it. */
      type FaultsOfDocument<U, R, D> = U extends string
        ? DocumentAt<U, R, D> extends infer T
          ? T extends { readonly $id: infer Own }
            ? [Own] extends [U]
              ? Faults<[T, `${U}#`], T, D>
              : `$id at ${U}#`
            : Faults<[T, `${U}#`], T, D>
          : never
        : never;
      /** `Found` holds faults, and the URIs of documents. The documents that are not in `Done` are read as well. */
      type WithDocuments<Found, Done, R, D> =
        Exclude<Extract<Found, readonly [unknown]>[0], Done> extends infer Next
          ? [Next] extends [never]
            ? Extract<Found, string>
            : WithDocuments<Found | FaultsOfDocument<Next, R, D>, Done | Next, R, D>
          : never;

      type Both<U> = (U extends unknown ? (value: U) => void : never) extends (value: infer I) => void ? I : never;
      type One<U> =
        Both<U extends unknown ? () => U : never> extends () => infer Last
          ? IsOneOf<Last, string> extends true
            ? Last & string
            : "schema at #"
          : "schema at #";
      /** A fault anywhere refuses the whole schema: in a union or an intersection of types a part that is refused could get lost. */
      type Whole<S, D> =
        WithDocuments<Faults<[S, "#"], S, D>, never, S, D> extends infer F
          ? [F] extends [never]
            ? From<S, S, D>
            : Refused<One<F>>
          : never;

      /** The type checks formats, refuses unknown keywords and reads the draft from `$schema`. Options that say otherwise are refused. */
      type OptionFault<S, O> =
        | ("formats" extends keyof O ? ([O["formats"]] extends [true] ? never : "formats at options") : never)
        | ("strict" extends keyof O ? ([O["strict"]] extends [true] ? never : "strict at options") : never)
        | ("draft" extends keyof O
            ? [O["draft"]] extends ["2020-12"]
              ? never
              : [O["draft"], S] extends ["draft-07", { readonly $schema: Draft7 }]
                ? never
                : "draft at options"
            : never);
      type OfValidator<S, O> = [OptionFault<S, O>] extends [never]
        ? Whole<S, "schemas" extends keyof O ? O["schemas"] : {}>
        : Refused<One<OptionFault<S, O>>>;
    }
  }

  interface ValidatorOptions {
    formats?: boolean;
    strict?: boolean;
    draft?: "2020-12" | "draft-07";
    schemas?: readonly unknown[] | Record<string, unknown>;
  }

  interface Validator<T = unknown> {
    check(value: unknown): value is T;
    validate(value: unknown): T;
    parse(text: string, reviver?: (this: any, key: string, value: any) => any): T;
    issues(value: unknown): Schema.Issue[];
    readonly schema: unknown;
  }

  const Validator: {
    new <T = never, const S = unknown, const O extends ValidatorOptions = {}>(
      schema: S,
      options?: O,
    ): Validator<[T] extends [never] ? Schema.JSONSchema.OfValidator<S, O> : T>;
    readonly prototype: Validator;
  };

  const JSON: JSON;
  interface JSON extends globalThis.JSON {
    parse<T = any>(text: string, reviver?: (this: any, key: string, value: any) => any): T;
    // TypeScript infers from the last signature, so `JSON.parse(text)` stays `any`.
    parse(text: string, reviver?: (this: any, key: string, value: any) => any): any;
  }

  global {
    export import Bun = BunModule;
  }
}

declare module "bun:bundle" {
  interface Registry {}

  function feature(flag: Registry extends { features: infer Features extends string } ? Features : string): boolean;

  function validate<T>(value: unknown): T;
}
