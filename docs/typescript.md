To install the TypeScript definitions for Bun's built-in APIs, install `@types/bun`.

```sh
$ bun add -D @types/bun # dev dependency
```

That's it—you should be able to reference the `Bun` global in your TypeScript files without seeing errors in your editor.

```ts
console.log(Bun.version);
```

{% callout %}
If you're still getting a `Cannot find name 'Bun'` error, try restarting the TypeScript server in your editor: Command Palette > TypeScript: Restart TS server.

If you have the `"types"` array defined in your `tsconfig.json` compiler options, you will need to add `"bun"` to the array.

```json#tsconfig.json
{
  "compilerOptions": {
    "types": ["bun"]
  }
}
```

{% endcallout %}

## Suggested `compilerOptions`

Bun supports things like top-level await, JSX, and extensioned `.ts` imports, which TypeScript doesn't allow by default. Below is a set of recommended `compilerOptions` for a Bun project, so you can use these features without seeing compiler warnings from TypeScript.

```jsonc
{
  "compilerOptions": {
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
