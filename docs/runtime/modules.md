Module resolution in JavaScript is a complex topic.

The ecosystem is currently in the midst of a years-long transition from CommonJS modules to native ES modules. TypeScript enforces its own set of rules around import extensions that aren't compatible with ESM. Different build tools support path re-mapping via disparate non-compatible mechanisms.

Bun aims to provide a consistent and predictable module resolution system that just works. Unfortunately it's still quite complex.

## Syntax

Consider the following files.

{% codetabs %}

```ts#index.ts
import { hello } from "./hello";

hello();
```

```ts#hello.ts
export function hello() {
  console.log("Hello world!");
}
```

{% /codetabs %}

When we run `index.ts`, it prints "Hello world".

```bash
$ bun index.ts
Hello world!
```

In this case, we are importing from `./hello`, a relative path with no extension. To resolve this import, Bun will check for the following files in order:

- `./hello.ts`
- `./hello.tsx`
- `./hello.js`
- `./hello.mjs`
- `./hello.cjs`
- `./hello/index.ts`
- `./hello/index.js`
- `./hello/index.json`
- `./hello/index.mjs`

Import paths are case-insensitive.

```ts#index.ts
import { hello } from "./hello";
import { hello } from "./HELLO";
import { hello } from "./hElLo";
```

Import paths can optionally include extensions. If an extension is present, Bun will only check for a file with that exact extension.

```ts#index.ts
import { hello } from "./hello";
import { hello } from "./hello.ts"; // this works
```

There is one exception: if you import `from "*.js{x}"`, Bun will additionally check for a matching `*.ts{x}` file, to be compatible with TypeScript's [ES module support](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-7.html#new-file-extensions).

```ts#index.ts
import { hello } from "./hello";
import { hello } from "./hello.ts"; // this works
import { hello } from "./hello.js"; // this also works
```

Bun supports both ES modules (`import`/`export` syntax) and CommonJS modules (`require()`/`module.exports`). The following CommonJS version would also work in Bun.

{% codetabs %}

```ts#index.js
const { hello } = require("./hello");

hello();
```

```ts#hello.js
function hello() {
  console.log("Hello world!");
}

exports.hello = hello;
```

{% /codetabs %}

That said, using CommonJS is discouraged in new projects.

## Resolution

Bun implements the Node.js module resolution algorithm, so you can import packages from `node_modules` with a bare specifier.

```ts
import { stuff } from "foo";
```

The full specification of this algorithm are officially documented in the [Node.js documentation](https://nodejs.org/api/modules.html); we won't rehash it here. Briefly: if you import `from "foo"`, Bun scans up the file system for a `node_modules` directory containing the package `foo`.

Once it finds the `foo` package, Bun reads the `package.json` to determine how the package should be imported. Unless `"type": "module"` is specified, Bun assumes the package is using CommonJS and transpiles into a synchronous ES module internally. To determine the package's entrypoint, Bun first reads the `exports` field in and checks the following conditions in order:

```jsonc#package.json
{
  "name": "foo",
  "exports": {
    "bun": "./index.js",        // highest priority
    "worker": "./index.js",
    "module": "./index.js",
    "node": "./index.js",
    "browser": "./index.js",
    "default": "./index.js"     // lowest priority
  }
}
```

Bun respects subpath [`"exports"`](https://nodejs.org/api/packages.html#subpath-exports) and [`"imports"`](https://nodejs.org/api/packages.html#imports). Specifying any subpath in the `"exports"` map will prevent other subpaths from being importable.

```jsonc#package.json
{
  "name": "foo",
  "exports": {
    ".": "./index.js",
    "./package.json": "./package.json" # subpath
  }
}
```

{% callout %}
**Shipping TypeScript** — Note that Bun supports the special `"bun"` export condition. If your library is written in TypeScript, you can publish your (un-transpiled!) TypeScript files to `npm` directly. If you specify your package's `*.ts` entrypoint in the `"bun"` condition, Bun will directly import and execute your TypeScript source files.
{% /callout %}

If `exports` is not defined, Bun falls back to `"module"` (ESM imports only) then [`"main"`](https://nodejs.org/api/packages.html#main).

```json#package.json
{
  "name": "foo",
  "module": "./index.js",
  "main": "./index.js"
}
```

## Path re-mapping

In the spirit of treating TypeScript as a first-class citizen, the Bun runtime will re-map import paths according to the [`compilerOptions.paths`](https://www.typescriptlang.org/tsconfig#paths) field in `tsconfig.json`. This is a major divergence from Node.js, which doesn't support any form of import path re-mapping.

```jsonc#tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "config": ["./config.ts"],         // map specifier to file
      "components/*": ["components/*"],  // wildcard matching
    }
  }
}
```

If you aren't a TypeScript user, you can create a [`jsconfig.json`](https://code.visualstudio.com/docs/languages/jsconfig) in your project root to achieve the same behavior.
