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

When we run `index.ts`, it prints "Hello world!".

```bash
$ bun index.ts
Hello world!
```

In this case, we are importing from `./hello`, a relative path with no extension. **Extensioned imports are optional but supported.** To resolve this import, Bun will check for the following files in order:

- `./hello.tsx`
- `./hello.jsx`
- `./hello.ts`
- `./hello.mjs`
- `./hello.js`
- `./hello.cjs`
- `./hello.json`
- `./hello/index.tsx`
- `./hello/index.jsx`
- `./hello/index.ts`
- `./hello/index.mjs`
- `./hello/index.js`
- `./hello/index.cjs`
- `./hello/index.json`

Import paths can optionally include extensions. If an extension is present, Bun will only check for a file with that exact extension.

```ts#index.ts
import { hello } from "./hello";
import { hello } from "./hello.ts"; // this works
```

If you import `from "*.js{x}"`, Bun will additionally check for a matching `*.ts{x}` file, to be compatible with TypeScript's [ES module support](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-7.html#new-file-extensions).

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

## Module systems

Bun has native support for CommonJS and ES modules. ES Modules are the recommended module format for new projects, but CommonJS modules are still widely used in the Node.js ecosystem.

In Bun's JavaScript runtime, `require` can be used by both ES Modules and CommonJS modules. If the target module is an ES Module, `require` returns the module namespace object (equivalent to `import * as`). If the target module is a CommonJS module, `require` returns the `module.exports` object (as in Node.js).

| Module Type | `require()`      | `import * as`                                                           |
| ----------- | ---------------- | ----------------------------------------------------------------------- |
| ES Module   | Module Namespace | Module Namespace                                                        |
| CommonJS    | module.exports   | `default` is `module.exports`, keys of module.exports are named exports |

### Using `require()`

You can `require()` any file or package, even `.ts` or `.mjs` files.

```ts
const { foo } = require("./foo"); // extensions are optional
const { bar } = require("./bar.mjs");
const { baz } = require("./baz.tsx");
```

{% details summary="What is a CommonJS module?" %}

In 2016, ECMAScript added support for [ES Modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules). ES Modules are the standard for JavaScript modules. However, millions of npm packages still use CommonJS modules.

CommonJS modules are modules that use `module.exports` to export values. Typically, `require` is used to import CommonJS modules.

```ts
// my-commonjs.cjs
const stuff = require("./stuff");
module.exports = { stuff };
```

The biggest difference between CommonJS and ES Modules is that CommonJS modules are synchronous, while ES Modules are asynchronous. There are other differences too.

- ES Modules support top-level `await` and CommonJS modules don't.
- ES Modules are always in [strict mode](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Strict_mode), while CommonJS modules are not.
- Browsers do not have native support for CommonJS modules, but they do have native support for ES Modules via `<script type="module">`.
- CommonJS modules are not statically analyzable, while ES Modules only allow static imports and exports.

**CommonJS Modules:** These are a type of module system used in JavaScript. One key feature of CommonJS modules is that they load and execute synchronously. This means that when you import a CommonJS module, the code in that module runs immediately, and your program waits for it to finish before moving on to the next task. It's similar to reading a book from start to finish without skipping pages.

**ES Modules (ESM):** These are another type of module system introduced in JavaScript. They have a slightly different behavior compared to CommonJS. In ESM, static imports (imports made using `import` statements) are synchronous, just like CommonJS. This means that when you import an ESM using a regular `import` statement, the code in that module runs immediately, and your program proceeds in a step-by-step manner. Think of it like reading a book page by page.

**Dynamic imports:** Now, here comes the part that might be confusing. ES Modules also support importing modules on the fly via the `import()` function. This is called a "dynamic import" and it's asynchronous, so it doesn't block the main program execution. Instead, it fetches and loads the module in the background while your program continues to run. Once the module is ready, you can use it. This is like getting additional information from a book while you're still reading it, without having to pause your reading.

**In summary:**

- CommonJS modules and static ES Modules (`import` statements) work in a similar synchronous way, like reading a book from start to finish.
- ES Modules also offer the option to import modules asynchronously using the `import()` function. This is like looking up additional information in the middle of reading the book without stopping.

{% /details %}

### Using `import`

You can `import` any file or package, even `.cjs` files.

```ts
import { foo } from "./foo"; // extensions are optional
import bar from "./bar.ts";
import { stuff } from "./my-commonjs.cjs";
```

### Using `import` and `require()` together

In Bun, you can use `import` or `require` in the same file—they both work, all the time.

```ts
import { stuff } from "./my-commonjs.cjs";
import Stuff from "./my-commonjs.cjs";
const myStuff = require("./my-commonjs.cjs");
```

### Top level await

The only exception to this rule is top-level await. You can't `require()` a file that uses top-level await, since the `require()` function is inherently synchronous.

Fortunately, very few libraries use top-level await, so this is rarely a problem. But if you're using top-level await in your application code, make sure that file isn't being `require()` from elsewhere in your application. Instead, you should use `import` or [dynamic `import()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import).

## Importing packages

Bun implements the Node.js module resolution algorithm, so you can import packages from `node_modules` with a bare specifier.

```ts
import { stuff } from "foo";
```

The full specification of this algorithm are officially documented in the [Node.js documentation](https://nodejs.org/api/modules.html); we won't rehash it here. Briefly: if you import `from "foo"`, Bun scans up the file system for a `node_modules` directory containing the package `foo`.

Once it finds the `foo` package, Bun reads the `package.json` to determine how the package should be imported. To determine the package's entrypoint, Bun first reads the `exports` field and checks for the following conditions.

```jsonc#package.json
{
  "name": "foo",
  "exports": {
    "bun": "./index.js",
    "worker": "./index.js",
    "node": "./index.js",
    "require": "./index.js", // if importer is CommonJS
    "import": "./index.mjs", // if importer is ES module
    "default": "./index.js",
  }
}
```

Whichever one of these conditions occurs _first_ in the `package.json` is used to determine the package's entrypoint.

Bun respects subpath [`"exports"`](https://nodejs.org/api/packages.html#subpath-exports) and [`"imports"`](https://nodejs.org/api/packages.html#imports).

```jsonc#package.json
{
  "name": "foo",
  "exports": {
    ".": "./index.js"
  }
}
```

Subpath imports and conditional imports work in conjunction with each other.

```json
{
  "name": "foo",
  "exports": {
    ".": {
      "import": "./index.mjs",
      "require": "./index.js"
    }
  }
}
```

As in Node.js, Specifying any subpath in the `"exports"` map will prevent other subpaths from being importable; you can only import files that are explicitly exported. Given the `package.json` above:

```ts
import stuff from "foo"; // this works
import stuff from "foo/index.mjs"; // this doesn't
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

{% details summary="Low-level details of CommonJS interop in Bun" %}

Bun's JavaScript runtime has native support for CommonJS. When Bun's JavaScript transpiler detects usages of `module.exports`, it treats the file as CommonJS. The module loader will then wrap the transpiled module in a function shaped like this:

```js
(function (module, exports, require) {
  // transpiled module
})(module, exports, require);
```

`module`, `exports`, and `require` are very much like the `module`, `exports`, and `require` in Node.js. These are assigned via a [`with scope`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/with) in C++. An internal `Map` stores the `exports` object to handle cyclical `require` calls before the module is fully loaded.

Once the CommonJS module is successfully evaluated, a Synthetic Module Record is created with the `default` ES Module [export set to `module.exports`](https://github.com/oven-sh/bun/blob/9b6913e1a674ceb7f670f917fc355bb8758c6c72/src/bun.js/bindings/CommonJSModuleRecord.cpp#L212-L213) and keys of the `module.exports` object are re-exported as named exports (if the `module.exports` object is an object).

When using Bun's bundler, this works differently. The bundler will wrap the CommonJS module in a `require_${moduleName}` function which returns the `module.exports` object.

{% /details %}
