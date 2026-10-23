// The standard library of TypeScript 7.1 has a second signature of `JSON.parse`, whose reviver takes
// `context`. `Bun.JSON` extends the library's `JSON`, so it needs that signature too. An older library
// has no such signature, and there the global `JSON` would no longer be assignable to `Bun.JSON`.

declare module "bun" {
  interface JSON {
    parse<T = any>(
      text: string,
      reviver?: (this: any, key: string, value: any, context: { source?: string }) => any,
    ): T;
  }
}
