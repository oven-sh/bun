# esdev

Incredibly fast ECMAScript & TypeScript bundler designed for development.

## Motivation

JavaScript bundlers run very slow in web browsers.

## Purpose

The purpose of esdev is to very quickly convert ECMAScript/TypeScript into something a web browser can execute.

Goals:

- Transpile fast inside a web browser. "Fast" is defined as "<= 3ms per un-minified file up to 1000 LOC" without build caching (FS cache yes).
- Transpile JSX to ECMAScript
- Remove TypeScript annotations
- Conditionally support React Fast Refresh
- Rewrite CommonJS/SystemJS/UMD imports and exports to ESM
- Support most of tsconfig.json/jsconfig.json
- Support `defines` like in esbuild
- Support esbuild plugins
- Support importing CSS files from JavaScript
- Tree-shaking

Non-goals:

- Bundling for production
- Minification
- AST plugins
- Support Node.js
- CommonJS, UMD, IIFE
- ES6 to ES5
- Supporting non-recent versions of Chromium, Firefox, or Safari. (No IE)

## How it works

Much of the code is a line-for-line port of esbuild to Zig, with a few important differences.

### Implementation differences

#### Moar lookup tables

### Why not just use esbuild?

#### Missing features

- Hot Module Reloading
- Rewrite CommonJS/SystemJS/UMD imports and exports to ESM
- React Fast Refresh

#### Go WASM performance isn't great.

There's a number of reasons for this:

- Unlike native targets, Go's WASM target runs the garbage collector on the same thread as the application. Since this usecase is very constrained (no need for shared memory, or long-term objects), rewriting in Zig lets us get away with a bump allocator -- skipping garbage collection entirely. This is faster than what Go does and possibly Rust, since this zeroes out the heap in one call at the end, rather than progressively zeroing memory.
- Goroutines cross the JS<>WASM binding, which is very slow. The more goroutines you use, the slower your code runs. When building a Zig project in single-threaded mode, Zig's `comptime` feature compiles away most of the difference.
- Slow startup time: unless you use TinyGo, Go WASM binaries are > 2 MB. In esbuild's case, at the time of writing its 6 MB. That's a lot of code for the web browser to download & compile.

#### Different constraints enable performance improvements

If bundler means "merge N source files into 1 or few source file(s)", esdev is most definitely not a bundler. Unlike most bundlers today, esdev deliberately outputs

If bundler means "turn my development code into something a browser can run",

### Compatibility Table

| Feature                              | esbuild | esdev |
| ------------------------------------ | ------- | ----- |
| JSX (transform)                      | ✅      | ⌛    |
| TypeScript (transform)               | ✅      | ⌛    |
| React Fast Refresh                   | ❌      | ⌛    |
| Hot Module Reloading                 | ❌      | ⌛    |
| Minification                         | ✅      | ❌    |
| Tree Shaking                         | ✅      | ⌛    |
| Incremental builds                   | ✅      | ⌛    |
| CSS                                  | ✅      | 🗓️    |
| Expose CSS dependencies per file     | ✅      | 🗓️    |
| CommonJS, IIFE, UMD outputs          | ✅      | ❌    |
| Node.js build target                 | ✅      | ❌    |
| Code Splitting                       | ✅      | ⌛    |
| Browser build target                 | ✅      | ⌛    |
| Bundling for production              | ✅      | ❌    |
| Support older browsers               | ✅      | ❌    |
| Plugins                              | ✅      | 🗓️    |
| AST Plugins                          | ❌      | ❌    |
| Filesystem Cache API (for plugins)   | ❓      | 🗓️    |
| Transform to ESM with `bundle` false | ❓      | ⌛    |

Key:

| Tag | Meaning                                    |
| --- | ------------------------------------------ |
| ✅  | Compatible                                 |
| ❌  | Not supported, and no plans to change that |
| ⌛  | In-progress                                |
| 🗓️  | Planned but work has not started           |
| ❓  | Unknown                                    |

#### Notes

##### Hot Module Reloading & React Fast Refresh

esdev exposes a runtime API to support Hot Module Reloading and React Fast Refresh. React Fast Refresh depends on Hot Module Reloading to work, but you can turn either of them off. esdev itself doesn't serve bundled files, it's up to the development server to provide that.

##### Code Splitting

esdev supports code splitting the way browsers do natively: through ES Modules. This works great for local development files. It doesn't work great for node_modules or for production due to the sheer number of network requests. There are plans to make this better, stay tuned.

##### Support older browsers

To simplify the parser, esdev doesn't support lowering features to non-current browsers. This means if you run a development build with esdev with, for example, optional chaining, it won't work in Internet Explorer 11. If you want to support older browsers, use a different tool.

#### Implementation Notes

##### Deviations from other bundlers

Unused imports are removed by default, unless they're an import without an identifier. This is similar to what the TypeScript compiler does, but TypeScript only does it for TypeScript. This is on by default, but you can turn it off.

For example in this code snippet, `forEach` in unused:

```ts
import { forEach, map } from "lodash-es";

const foo = map(["bar", "baz"], (item) => {});
```

So it's never included.

```ts
import { map } from "lodash-es";

const foo = map(["bar", "baz"], (item) => {});
```

If 

##### HMR & Fast Refresh implementation

This section only applies when Hot Module Reloading is enabled. When it's off, none of this part runs. React Fast Refresh depends on Hot Module Reloading.

###### What is hot module reloading?

HMR: "hot module reloading"

A lot of developers know what it does -- but what actually is it and how does it work? Essentially, it means when a source file changes, automatically reload the code without reloading the web page.

A big caveat here is JavaScript VMs don't expose an API to "unload" parts of the JavaScript context. In all HMR implementations, What really happens is this:

1. Load a new copy of the code that changed
2. Update references to the old code to point to the new code
3. Handle errors

The old code still lives there, in your browser's JavaScript VM until the page is refreshed. If any past references are kept (side effects!), undefined behavior happens. That's why, historically (by web standards), HMR has a reputation for being buggy.

Loading code is easy. The hard parts are updating references and handling errors.

There are two ways to update references:

- Update all module imports
- Update the exports

Either approach works.

###### How it's implemented in esdev

TODO: doc
