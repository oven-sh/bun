To install the TypeScript definitions for Bun's built-in APIs, install `bun-types`.

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

At this point, you should be able to reference the `Bun` global in your TypeScript files without seeing errors in your editor.

```ts
console.log(Bun.version);
```

## Suggested `compilerOptions`

Bun supports things like top-level await, JSX, and extensioned `.ts` imports, which TypeScript doesn't allow by default. Below is a set of recommended `compilerOptions` for a Bun project, so you can use these features without seeing compiler warnings from TypeScript.

```jsonc
{
  "compilerOptions": {
    // add Bun type definitions
    "types": ["bun-types"],

    // enable latest features
    "lib": ["ESNext"],
    "module": "esnext",
    "target": "esnext",

    // if TS 5.x+
    "moduleResolution": "bundler",
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "moduleDetection": "force",
    // if TS 4.x or earlier
    // "moduleResolution": "nodenext",

    "jsx": "react-jsx", // support JSX
    "allowJs": true, // allow importing `.js` from `.ts`

    // best practices
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "composite": true,
    "downlevelIteration": true,
    "allowSyntheticDefaultImports": true
  }
}
```

If you run `bun init` in a new directory, this `tsconfig.json` will be generated for you.

```sh
$ bun init
```

## DOM types

Unfortunately, setting a value for `"types"` means that TypeScript will ignore other global type definitions, including `lib: ["dom"]`. If you need to add DOM types into your project, add the following [triple-slash directives](https://www.typescriptlang.org/docs/handbook/triple-slash-directives.html) at the top of any TypeScript file in your project.

```ts
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
```
