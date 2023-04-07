Bun treats TypeScript as a first-class citizen.

## Running `.ts` files

Bun can directly execute `.ts` and `.tsx` files just like vanilla JavaScript, with no extra configuration. If you import a `.ts` or `.tsx` file (or an `npm` module that exports these files), Bun internally transpiles it into JavaScript then executes the file.

**Note** — Similar to other build tools, Bun does not typecheck the files. Use [`tsc --noEmit`](https://www.typescriptlang.org/docs/handbook/compiler-options.html) (the official TypeScript CLI) if you're looking to catch static type errors.

{% callout %}

**Is transpiling still necessary?** — Because Bun can directly execute TypeScript, you may not need to transpile your TypeScript to run in production. Bun internally transpiles every file it executes (both `.js` and `.ts`), so the additional overhead of directly executing your `.ts/.tsx` source files is negligible.

That said, if you are using Bun as a development tool but still targeting Node.js or browsers in production, you'll still need to transpile.

{% /callout %}

## Configuring `tsconfig.json`

Bun supports a number of features that TypeScript doesn't support by default, such as extensioned imports, top-level await, and `exports` conditions. It also implements global APIs like the `Bun`. To enable these features, your `tsconfig.json` must be configured properly.

{% callout %}
If you initialized your project with `bun init`, everything is already configured properly.
{% /callout %}

To get started, install the `bun-types` package. If you initialized your project with `bun init`, everything is already configured properly.

```sh
$ bun add -d bun-types # dev dependency
```

If you're using a canary build of Bun, use the `canary` tag. The canary package is updated on every commit to the `main` branch.

```sh
# if you're using a canary build of Bun
$ bun add -d bun-types@canary
```

### Quick setup

{% callout %}

**Note** — This approach requires TypeScript 5.0 or later!

{% /callout %}

Add the following to your `tsconfig.json`.

```json-diff
  {
+   "extends": ["bun-types"]
    // other options...
  }
```

{% callout %}
**Note** — The `"extends"` field in your `tsconfig.json` can accept an array of values. If you're already using `"extends"`, just add `"bun-types"` to the array.
{% /callout %}

That's it! You should be able to use Bun's full feature set without seeing any TypeScript compiler errors.

### Manual setup

These are the recommended `compilerOptions` for a Bun project.

```jsonc
{
  "compilerOptions": {
    // enable latest features
    "lib": ["esnext"],
    "module": "esnext",
    "target": "esnext",

    // if TS 5.x+
    "moduleResolution": "bundler",
    // if TS 4.x or earlier
    "moduleResolution": "nodenext",

    // support JSX, CommonJS, ES imports
    "jsx": "react-jsx", // support JSX
    "allowJs": true, // allow importing `.js` from `.ts`
    "esModuleInterop": true, // allow default imports for CommonJS modules
    "allowImportingTsExtensions": true,

    // best practices
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,

    // add Bun type definitions
    "types": ["bun-types"]
  }
}
```

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
