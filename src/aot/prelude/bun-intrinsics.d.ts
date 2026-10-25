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
    type Pattern<S extends string> = { readonly "bun.pattern"?: S };
    type Format<S extends "email" | "uuid" | "ipv4" | "ipv6" | "date" | "date-time" | "url"> = {
      readonly "bun.format"?: S;
    };
    type Message<S extends string> = { readonly "bun.message"?: S };
    type Default<V extends string | number | boolean | null> = { readonly "bun.default"?: V };
    type Strict = { readonly "bun.strict"?: true };
    type DeepStrict = { readonly "bun.strict"?: "deep" };
  }

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

