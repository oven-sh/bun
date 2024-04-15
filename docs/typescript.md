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
    // Enable latest features
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "ESNext",
    "moduleDetection": "force",
    "jsx": "react-jsx",
    "allowJs": true,

    // Bundler mode
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,

    // Best practices
    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,

    // Some stricter flags
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noPropertyAccessFromIndexSignature": true
  }
}
```

If you run `bun init` in a new directory, this `tsconfig.json` will be generated for you. (The stricter flags are disabled by default.)

```sh
$ bun init
```
