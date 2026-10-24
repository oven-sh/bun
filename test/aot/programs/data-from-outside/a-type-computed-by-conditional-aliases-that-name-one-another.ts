import { JSON, type Schema } from "bun";

// Each alias names the others in several arms, with arguments that `infer` binds.
type Text<S> = string &
  (S extends { readonly minLength: infer N extends number } ? Schema.MinLength<N> : unknown) &
  (S extends { readonly maxLength: infer N extends number } ? Schema.MaxLength<N> : unknown) &
  (S extends { readonly pattern: infer P extends string } ? Schema.Pattern<P> : unknown);

type Numeric<S> = number &
  (S extends { readonly minimum: infer N extends number } ? Schema.Min<N> : unknown) &
  (S extends { readonly maximum: infer N extends number } ? Schema.Max<N> : unknown) &
  (S extends { readonly exclusiveMinimum: infer N extends number } ? Schema.Above<N> : unknown) &
  (S extends { readonly exclusiveMaximum: infer N extends number } ? Schema.Below<N> : unknown) &
  (S extends { readonly multipleOf: infer N extends number } ? Schema.MultipleOf<N> : unknown);

type Elements<S, R> = S extends { readonly prefixItems: infer P extends readonly unknown[]; readonly items: false }
  ? { -readonly [I in keyof P]: From<P[I], R> }
  : S extends { readonly items: infer I }
    ? From<I, R>[]
    : unknown[];

type List<S, R> = Elements<S, R> &
  (S extends { readonly minItems: infer N extends number } ? Schema.MinItems<N> : unknown) &
  (S extends { readonly maxItems: infer N extends number } ? Schema.MaxItems<N> : unknown);

type RequiredNames<S> = S extends { readonly required: infer Q extends readonly string[] } ? Q[number] : never;

type Flat<T> = { [K in keyof T]: T[K] };

type Members<P, Q, R> = Flat<
  { -readonly [K in keyof P as K extends Q ? K : never]: From<P[K], R> } & {
    -readonly [K in keyof P as K extends Q ? never : K]?: From<P[K], R>;
  } & { [K in Exclude<Q, keyof P> & string]: unknown }
>;

type Fields<S, R> = S extends { readonly properties: infer P }
  ? S extends { readonly additionalProperties: false }
    ? Members<P, RequiredNames<S>, R> & Schema.Strict
    : Members<P, RequiredNames<S>, R>
  : S extends { readonly additionalProperties: infer A extends object }
    ? Record<string, From<A, R>>
    : Members<{}, RequiredNames<S>, R>;

type OfKind<K, S, R> = K extends "string"
  ? Text<S>
  : K extends "number"
    ? Numeric<S>
    : K extends "integer"
      ? Numeric<S> & Schema.Int
      : K extends "boolean"
        ? boolean
        : K extends "null"
          ? null
          : K extends "array"
            ? List<S, R>
            : K extends "object"
              ? Fields<S, R>
              : unknown;

type ByType<S, R> = S extends { readonly type: infer K }
  ? K extends readonly unknown[]
    ? OfKind<K[number], S, R>
    : OfKind<K, S, R>
  : unknown;

type Arms<A, R> = A extends readonly unknown[] ? { [I in keyof A]: From<A[I], R> }[number] : unknown;

type All<A, R> = A extends readonly [infer First, ...infer Rest] ? From<First, R> & All<Rest, R> : unknown;

type Mutable<V> = V extends readonly unknown[] | object ? { -readonly [K in keyof V]: Mutable<V[K]> } : V;

type Ref<P, R> = P extends "#"
  ? From<R, R>
  : P extends `#/$defs/${infer N}`
    ? R extends { readonly $defs: infer D }
      ? N extends keyof D
        ? From<D[N], R>
        : unknown
      : unknown
    : P extends `#/definitions/${infer N}`
      ? R extends { readonly definitions: infer D }
        ? N extends keyof D
          ? From<D[N], R>
          : unknown
        : unknown
      : unknown;

type From<S, R = S> = S extends boolean
  ? S extends false
    ? never
    : unknown
  : S extends { readonly $ref: infer P }
    ? Ref<P, R>
    : S extends { readonly const: infer C }
      ? Mutable<C>
      : S extends { readonly enum: infer E extends readonly unknown[] }
        ? Mutable<E[number]>
        :
            | (ByType<S, R> &
                (S extends { readonly anyOf: infer A } ? Arms<A, R> : unknown) &
                (S extends { readonly oneOf: infer A } ? Arms<A, R> : unknown) &
                (S extends { readonly allOf: infer A } ? All<A, R> : unknown))
            | (S extends { readonly nullable: true } ? null : never);

const description = {
  type: "object",
  properties: {
    kind: { enum: ["circle", "square"] },
    sizes: { type: "array", items: { type: "number" } },
    label: { anyOf: [{ type: "string" }, { type: "number" }] },
    inner: { type: "object", properties: { kind: { enum: [1, 2] } }, required: ["kind"], additionalProperties: false },
    next: { $ref: "#" },
  },
  required: ["kind", "sizes", "label", "inner"],
} as const;

for (const text of [
  '{"kind":"circle","sizes":[1,2],"label":"a","inner":{"kind":1}}',
  '{"kind":"square","sizes":[],"label":5,"inner":{"kind":2}}',
  '{"kind":"line","sizes":[],"label":5,"inner":{"kind":2}}',
  '{"kind":"circle","sizes":[1,"2"],"label":5,"inner":{"kind":2}}',
  '{"kind":"circle","sizes":[],"label":null,"inner":{"kind":2}}',
  '{"kind":"circle","sizes":[],"label":"a","inner":{"kind":3}}',
  '{"kind":"circle","sizes":[],"label":"a"}',
  '{"kind":"circle","sizes":[],"label":"a","inner":{"kind":1,"more":1}}',
  '{"kind":"circle","sizes":[],"label":"a","inner":{"kind":1},"next":{"kind":"square","sizes":[3],"label":1,"inner":{"kind":2}}}',
  '{"kind":"circle","sizes":[],"label":"a","inner":{"kind":1},"next":{"kind":"square","sizes":[3],"label":1,"inner":{"kind":4}}}',
]) {
  try {
    console.log(JSON.stringify(JSON.parse<From<typeof description>>(text)));
  } catch (error) {
    for (const issue of (error as Schema.Error).issues) console.log("refused at", issue.path.join("."), "for", issue.code);
  }
}
