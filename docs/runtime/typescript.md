Bun treats TypeScript as a first-class citizen.

{% callout %}

**Note** — To add type declarations for Bun APIs like the `Bun` global, follow the instructions at [Intro > TypeScript](https://bun.sh/docs/typescript). This page describes how the Bun runtime runs TypeScript code.

{% /callout %}

## Running `.ts` files

Bun can directly execute `.ts` and `.tsx` files just like vanilla JavaScript, with no extra configuration. If you import a `.ts` or `.tsx` file (or an `npm` module that exports these files), Bun internally transpiles it into JavaScript then executes the file.

**Note** — Similar to other build tools, Bun does not typecheck the files. Use [`tsc`](https://www.typescriptlang.org/docs/handbook/compiler-options.html) (the official TypeScript CLI) if you're looking to catch static type errors.

{% callout %}

**Is transpiling still necessary?** — Because Bun can directly execute TypeScript, you may not need to transpile your TypeScript to run in production. Bun internally transpiles every file it executes (both `.js` and `.ts`), so the additional overhead of directly executing your `.ts/.tsx` source files is negligible.

That said, if you are using Bun as a development tool but still targeting Node.js or browsers in production, you'll still need to transpile.

{% /callout %}

## Path mapping

When resolving modules, Bun's runtime respects path mappings defined in [`compilerOptions.paths`](https://www.typescriptlang.org/tsconfig#paths) in your `tsconfig.json`. No other runtime does this.

Consider the following `tsconfig.json`.

```json
{
  "compilerOptions": {
    "baseUrl": "./src",
    "paths": {
      "data": ["./data.ts"]
    }
  }
}
```

Bun will use `baseUrl` to resolve module paths.

```ts
// resolves to ./src/components/Button.tsx
import { Button } from "components/Button.tsx";
```

Bun will also correctly resolve imports from `"data"`.

{% codetabs %}

```ts#index.ts
import { foo } from "data";
console.log(foo); // => "Hello world!"
```

```ts#data.ts
export const foo = "Hello world!"
```

{% /codetabs %}
