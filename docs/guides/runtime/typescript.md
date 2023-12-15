---
name: Install TypeScript declarations for Bun
---

To install TypeScript definitions for Bun's built-in APIs in your project, install `@types/bun`.

```sh
$ bun add -D @types/bun # dev dependency
```

---

If you're still getting a `Cannot find name 'Bun'` error, try restarting the TypeScript server in your editor: Command Palette > TypeScript: Restart TS server.

---

If you have the `"types"` array defined in your `tsconfig.json` compiler options, you will need to add `"bun"` to the array.

```json#tsconfig.json
{
  "compilerOptions": {
    "types": ["bun"]
  }
}
```

---

Below is the full set of recommended `compilerOptions` for a Bun project. With this `tsconfig.json`, you can use top-level await, extensioned or extensionless imports, and JSX.

```jsonc
{
  "compilerOptions": {
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
