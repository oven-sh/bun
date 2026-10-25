declare namespace Bun {
  interface JSON extends globalThis.JSON {
    parse<T>(text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown): T;
  }
  const JSON: JSON;
}

declare module "bun:bundle" {
  export function validate<T>(value: unknown): T;
}
