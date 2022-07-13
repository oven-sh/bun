## Using bun with TypeScript

### Transpiling TypeScript with Bun

TypeScript just works. There’s nothing to configure and nothing extra to install. If you import a `.ts` or `.tsx` file, bun will transpile it into JavaScript. bun also transpiles `node_modules` containing `.ts` or `.tsx` files. This is powered by bun’s TypeScript transpiler, so it’s fast.

bun also reads `tsconfig.json`, including `baseUrl` and `paths`.

### Adding Type Definitions

To get TypeScript working with the global API, add `bun-types` to your project:

```sh
bun add -d bun-types
```

And to the `types` field in your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "types": ["bun-types"]
  }
}
```
