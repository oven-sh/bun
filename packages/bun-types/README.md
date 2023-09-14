# TypeScript types for Bun

<p align="center">
  <a href="https://bun.sh"><img src="https://bun.sh/logo@2x.png" alt="Logo"></a>
</p>

These are the type definitions for Bun's JavaScript runtime APIs.

# Installation

Install the `bun-types` npm package:

```bash
# yarn/npm/pnpm work too, "bun-types" is an ordinary npm package
bun add -d bun-types
```

# Usage

Add this to your `tsconfig.json` or `jsconfig.json`:

```jsonc-diff
  {
    "compilerOptions": {
+     "types": ["bun-types"]
      // other options...
    }

    // other options...
  }
```

# Contributing

`bun-types` is generated via [./scripts/bundle.ts](./scripts/bundle.ts).

To add a new file, add it under `packages/bun-types`. Then add a [triple-slash directive](https://www.typescriptlang.org/docs/handbook/triple-slash-directives.html) pointing to it inside [./index.d.ts](./index.d.ts).

```diff
+ /// <reference path="./newfile.d.ts" />
```

[`./bundle.ts`](./bundle.ts) merges the types in this folder into a single file. To run it:

```bash
bun build
```
