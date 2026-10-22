interface JSON {
  parse<T>(text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown): T;
}

declare module "bun:bundle" {
  export function validate<T>(value: unknown): T;
}
