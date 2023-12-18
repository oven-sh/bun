# TypeScript types for Bun

<p align="center">
  <a href="https://bun.sh"><img src="https://bun.sh/logo@2x.png" alt="Logo"></a>
</p>

These are the type definitions for Bun's JavaScript runtime APIs.

# Installation

Install the `@types/bun` npm package:

```bash
# yarn/npm/pnpm work too
# @types/bun is an ordinary npm package
bun add -D @types/bun
```

That's it! VS Code and TypeScript automatically load `@types/*` packages into your project, so the `Bun` global and all `bun:*` modules should be available immediately.

# Contributing

The `@types/bun` package is a shim that loads `bun-types`. The `bun-types` package lives in the Bun repo under `packages/bun-types`. It is generated via [./scripts/bundle.ts](./scripts/bundle.ts).

To add a new file, add it under `packages/bun-types`. Then add a [triple-slash directive](https://www.typescriptlang.org/docs/handbook/triple-slash-directives.html) pointing to it inside [./index.d.ts](./index.d.ts).

```diff
+ /// <reference path="./newfile.d.ts" />
```

[`./bundle.ts`](./bundle.ts) merges the types in this folder into a single file. To run it:

```bash
bun build
```
