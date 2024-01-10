To install the TypeScript definitions for Bun's built-in APIs, install `@types/bun`.

```sh
$ bun add -d @types/bun # dev dependency
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
    // enable latest features
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "ESNext",
    "moduleDetection": "force",
    "jsx": "react-jsx", // support JSX
    "allowJs": true, // allow importing `.js` from `.ts`

    // Bundler mode
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,

    // Best practices
    "strict": true,
    "skipLibCheck": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,

    // Some stricter flags
    "useUnknownInCatchVariables": true,
    "noPropertyAccessFromIndexSignature": true
  }
}
```

If you run `bun init` in a new directory, this `tsconfig.json` will be generated for you.

```sh
$ bun init
```
