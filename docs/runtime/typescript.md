Bun can directly execute `.ts` and `.tsx` files with no extra configuration. If you import a `.ts` or `.tsx` file, Bun internally transpiles it into JavaScript then executes the file.

{% callout %}
**Note** — Similar to other build tools, Bun does not typecheck the files. Use [`tsc --noEmit`](https://www.typescriptlang.org/docs/handbook/compiler-options.html) (the official TypeScript CLI) if you're looking to catch static type errors.
{% /callout %}

## Configuring `tsconfig.json`

When using TypeScript and Bun together, it's important to properly configure your `tsconfig.json`.

First, install the TypeScript definitions for Bun's built-in APIs:

```sh
$ bun add -d bun-types # dev dependency
```

Then include `"bun-types"` in the `compilerOptions.types` in your `tsconfig.json`:

```json-diff
  {
    "compilerOptions": {
+     "types": ["bun-types"]
    }
  }
```

This is the most important step, as it allows you to use Bun's built in APIs without seeing TypeScript errors in your IDE.

Bun implements a range of [modern ECMAScript features](https://github.com/sudheerj/ECMAScript-features), like bigint literals, nullish coalescing, dynamic imports, `import.meta`, `globalThis`, ES modules, top-level await, and more. To use these features without seeing TypeScript errors in your IDE, set the following `compilerOptions`:

```jsonc
{
  "compilerOptions": {
    // enable latest features
    "lib": ["esnext"],
    "module": "esnext",
    "target": "esnext",

    // typescript 5.x+
    "moduleResolution": "bundler",
    // typescript 4.x or earlier
    "moduleResolution": "nodenext",

    // support JSX, CommonJS
    "jsx": "react-jsx", // support JSX (value doesn't matter)
    "allowJs": true, // allow importing `.js` from `.ts`
    "esModuleInterop": true, // allow default imports for CommonJS modules

    // best practices
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,

    // add Bun type definitions
    "types": ["bun-types"]
  }
}
```

If you use `bun init`, an appropriate `tsconfig.json` is automatically generated for you.

## Path mapping

When resolving modules, Bun's runtime respects path mappings defined in [`compilerOptions.paths`](https://www.typescriptlang.org/tsconfig#paths) in your `tsconfig.json`. No other runtime does this.

Given the following `tsconfig.json`...

```json
{
  "compilerOptions": {
    "paths": {
      "data": ["./data.ts"]
    }
  }
}
```

...the import from `"data"` will work as expected.

{% codetabs %}

```ts#index.ts
import { foo } from "data";
console.log(foo); // => "Hello world!"
```

```ts#data.ts
export const foo = "Hello world!"
```

{% /codetabs %}
