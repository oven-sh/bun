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
| React Fast Refresh                   | ❌[1]   | ⌛    |
| Hot Module Reloading                 | ❌[1]   | ⌛    |
| Minification                         | ✅      | ❌    |
| JSX (transform)                      | ✅      | ⌛    |
| TypeScript (transform)               | ✅      | ⌛    |
| Tree Shaking                         | ✅      | ⌛    |
| Incremental builds                   | ✅      | ⌛    |
| CSS                                  | ✅      | 🗓️    |
| CommonJS, IIFE, UMD outputs          | ✅      | ❌    |
| Node.js build target                 | ✅      | ❌    |
| Browser build target                 | ✅      | ⌛    |
| Support older browsers               | ✅      | ❌[2] |
| Plugins                              | ✅      | ⌛[3] |
| AST Plugins                          | ❌      | ❌[4] |
| Filesystem Cache API (for plugins)   | ❓      | 🗓️[4] |
| Transform to ESM with `bundle` false | ❓      | ⌛    |

Key:
|Tag | Meaning
|----|----------------------------------------------|
| ✅ | Compatible |
| ❌ | Not supported, and no plans to change that |
| ⌛ | In-progress |
| 🗓️ | Planned but work has not started |
| ❓ | Unknown |

Notes:
[1]: https://esbuild.github.io/faq/#upcoming-roadmap
