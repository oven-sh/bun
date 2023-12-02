---
name: Install TypeScript declarations for Bun
---

To install TypeScript definitions for Bun's built-in APIs in your project, install `bun-types`.

```sh
$ bun add -d bun-types # dev dependency
```

---

Then include `"bun-types"` in the `compilerOptions.types` in your `tsconfig.json`:

```json-diff
  {
    "compilerOptions": {
+     "types": ["bun-types"]
    }
  }
```

---

Unfortunately, setting a value for `"types"` means that TypeScript will ignore other global type definitions, including `lib: ["dom"]`. If you need to add DOM types into your project, add the following [triple-slash directives](https://www.typescriptlang.org/docs/handbook/triple-slash-directives.html) at the top of any TypeScript file in your project.

```ts
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
```

---

Below is the full set of recommended `compilerOptions` for a Bun project. With this `tsconfig.json`, you can use top-level await, extensioned or extensionless imports, and JSX.

```jsonc
{
  "compilerOptions": {
    // add Bun type definitions
    "types": ["bun-types"],

    // enable latest features
    "lib": ["esnext"],
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
    "esModuleInterop": true, // allow default imports for CommonJS modules

    // best practices
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  }
}
```

---

Refer to [Ecosystem > TypeScript](/docs/runtime/typescript) for a complete guide to TypeScript support in Bun.
