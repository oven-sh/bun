---
name: Install TypeScript declarations for Bun
---

To install TypeScript definitions for Bun's built-in APIs in your project, install `@types/bun`.

```sh
$ bun add -d @types/bun # dev dependency
```

---

Below is the full set of recommended `compilerOptions` for a Bun project. With this `tsconfig.json`, you can use top-level await, extensioned or extensionless imports, and JSX.

```jsonc
{
  "compilerOptions": {
    // Enable latest features
    "lib": ["ESNext", "DOM"],
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
    "noPropertyAccessFromIndexSignature": true,
  },
}
```

---

Refer to [Ecosystem > TypeScript](https://bun.sh/docs/runtime/typescript) for a complete guide to TypeScript support in Bun.
