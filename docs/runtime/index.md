Bun is a new JavaScript & TypeScript runtime designed to be a faster, leaner, and more modern drop-in replacement for Node.js.

## Speed

Bun is designed to start fast and run fast. Its transpiler and runtime are written in Zig, a modern, high-performance language. On Linux, this translates into startup times [4x faster](https://twitter.com/jarredsumner/status/1499225725492076544) than Node.js.

{% image src="/images/bun-run-speed.jpeg" caption="Bun vs Node.js vs Deno running Hello World" /%}

<!-- If no `node_modules` directory is found in the working directory or above, Bun will abandon Node.js-style module resolution in favor of the `Bun module resolution algorithm`. Under Bun-style module resolution, all packages are _auto-installed_ on the fly into a [global module cache](https://bun.com/docs/install/cache). For full details on this algorithm, refer to [Runtime > Modules](https://bun.com/docs/runtime/modules). -->

Performance sensitive APIs like `Buffer`, `fetch`, and `Response` are heavily profiled and optimized. Under the hood Bun uses the [JavaScriptCore engine](https://developer.apple.com/documentation/javascriptcore), which is developed by Apple for Safari. It starts and runs faster than V8, the engine used by Node.js and Chromium-based browsers.

## TypeScript

Bun natively supports TypeScript out of the box. All files are transpiled on the fly by Bun's fast native transpiler before being executed. Similar to other build tools, Bun does not perform typechecking; it simply removes type annotations from the file.

```bash
$ bun index.js
$ bun index.jsx
$ bun index.ts
$ bun index.tsx
```

Some aspects of Bun's runtime behavior are affected by the contents of your `tsconfig.json` file. Refer to [Runtime > TypeScript](https://bun.com/docs/runtime/typescript) page for details.

<!-- Before execution, Bun internally transforms all source files to vanilla JavaScript using its fast native transpiler. The transpiler looks at the files extension to determine how to handle it. -->

<!--

every file before execution. Its transpiler  can directly run TypeScript and JSX `{.js|.jsx|.ts|.tsx}` files directly. During execution, Bun internally transpiles all files (including `.js` files) to vanilla JavaScript with its fast native transpiler. -->

<!-- A loader determines how to map imports &amp; file extensions to transforms and output. -->

<!-- Currently, Bun implements the following loaders: -->

<!-- {% table %}

- Extension
- Transforms
- Output (internal)

---

- `.js`
- JSX + JavaScript
- `.js`

---

- `.jsx`
- JSX + JavaScript
- `.js`

---

- `.ts`
- TypeScript + JavaScript
- `.js`

---

- `.tsx`
- TypeScript + JSX + JavaScript
- `.js`

---

- `.mjs`
- JavaScript
- `.js`

---

- `.cjs`
- JavaScript
- `.js`

---

- `.mts`
- TypeScript
- `.js`

---

- `.cts`
- TypeScript
- `.js`


{% /table %} -->

## JSX

## JSON, TOML, and YAML

Source files can import `*.json`, `*.toml`, or `*.yaml` files to load their contents as plain JavaScript objects.

```ts
import pkg from "./package.json";
import bunfig from "./bunfig.toml";
import config from "./config.yaml";
```

See the [YAML API documentation](/docs/api/yaml) for more details on YAML support.

## WASI

{% callout %}
🚧 **Experimental**
{% /callout %}

Bun has experimental support for WASI, the [WebAssembly System Interface](https://github.com/WebAssembly/WASI). To run a `.wasm` binary with Bun:

```bash
$ bun ./my-wasm-app.wasm
# if the filename doesn't end with ".wasm"
$ bun run ./my-wasm-app.whatever
```

{% callout %}

**Note** — WASI support is based on [wasi-js](https://github.com/sagemathinc/cowasm/tree/main/core/wasi-js). Currently, it only supports WASI binaries that use the `wasi_snapshot_preview1` or `wasi_unstable` APIs. Bun's implementation is not fully optimized for performance; this will become more of a priority as WASM grows in popularity.
{% /callout %}

## Node.js compatibility

Long-term, Bun aims for complete Node.js compatibility. Most Node.js packages already work with Bun out of the box, but certain low-level APIs like `dgram` are still unimplemented. Track the current compatibility status at [Ecosystem > Node.js](https://bun.com/docs/runtime/nodejs-apis).

Bun implements the Node.js module resolution algorithm, so dependencies can still be managed with `package.json`, `node_modules`, and CommonJS-style imports.

{% callout %}
**Note** — We recommend using Bun's [built-in package manager](https://bun.com/docs/cli/install) for a performance boost over other npm clients.
{% /callout %}

## Web APIs

<!-- When prudent, Bun attempts to implement Web-standard APIs instead of introducing new APIs. Refer to [Runtime > Web APIs](https://bun.com/docs/web-apis) for a list of Web APIs that are available in Bun. -->

Some Web APIs aren't relevant in the context of a server-first runtime like Bun, such as the [DOM API](https://developer.mozilla.org/en-US/docs/Web/API/HTML_DOM_API#html_dom_api_interfaces) or [History API](https://developer.mozilla.org/en-US/docs/Web/API/History_API). Many others, though, are broadly useful outside of the browser context; when possible, Bun implements these Web-standard APIs instead of introducing new APIs.

The following Web APIs are partially or completely supported.

{% table %}

---

- HTTP
- [`fetch`](https://developer.mozilla.org/en-US/docs/Web/API/fetch) [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response) [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request) [`Headers`](https://developer.mozilla.org/en-US/docs/Web/API/Headers) [`AbortController`](https://developer.mozilla.org/en-US/docs/Web/API/AbortController) [`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal)

---

- URLs
- [`URL`](https://developer.mozilla.org/en-US/docs/Web/API/URL) [`URLSearchParams`](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams)

---

- Streams
- [`ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream) [`WritableStream`](https://developer.mozilla.org/en-US/docs/Web/API/WritableStream) [`TransformStream`](https://developer.mozilla.org/en-US/docs/Web/API/TransformStream) [`ByteLengthQueuingStrategy`](https://developer.mozilla.org/en-US/docs/Web/API/ByteLengthQueuingStrategy) [`CountQueuingStrategy`](https://developer.mozilla.org/en-US/docs/Web/API/CountQueuingStrategy) and associated classes

---

- Blob
- [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob)

---

- WebSockets
- [`WebSocket`](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)

---

- Encoding and decoding
- [`atob`](https://developer.mozilla.org/en-US/docs/Web/API/atob) [`btoa`](https://developer.mozilla.org/en-US/docs/Web/API/btoa) [`TextEncoder`](https://developer.mozilla.org/en-US/docs/Web/API/TextEncoder) [`TextDecoder`](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder)

---

- Timeouts
- [`setTimeout`](https://developer.mozilla.org/en-US/docs/Web/API/setTimeout) [`clearTimeout`](https://developer.mozilla.org/en-US/docs/Web/API/clearTimeout)

---

- Intervals
- [`setInterval`](https://developer.mozilla.org/en-US/docs/Web/API/setInterval)[`clearInterval`](https://developer.mozilla.org/en-US/docs/Web/API/clearInterval)

---

- Crypto
- [`crypto`](https://developer.mozilla.org/en-US/docs/Web/API/Crypto) [`SubtleCrypto`](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto)
  [`CryptoKey`](https://developer.mozilla.org/en-US/docs/Web/API/CryptoKey)

---

- Debugging

- [`console`](https://developer.mozilla.org/en-US/docs/Web/API/console) [`performance`](https://developer.mozilla.org/en-US/docs/Web/API/Performance)

---

- Microtasks
- [`queueMicrotask`](https://developer.mozilla.org/en-US/docs/Web/API/queueMicrotask)

---

- Errors
- [`reportError`](https://developer.mozilla.org/en-US/docs/Web/API/reportError)

---

- User interaction
- [`alert`](https://developer.mozilla.org/en-US/docs/Web/API/Window/alert) [`confirm`](https://developer.mozilla.org/en-US/docs/Web/API/Window/confirm) [`prompt`](https://developer.mozilla.org/en-US/docs/Web/API/Window/prompt) (intended for interactive CLIs)

<!-- - Blocking. Prints the alert message to terminal and awaits `[ENTER]` before proceeding. -->
<!-- - Blocking. Prints confirmation message and awaits `[y/N]` input from user. Returns `true` if user entered `y` or `Y`, `false` otherwise.
- Blocking. Prints prompt message and awaits user input. Returns the user input as a string. -->

---

- Realms
- [`ShadowRealm`](https://github.com/tc39/proposal-shadowrealm)

---

- Events
- [`EventTarget`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget)
  [`Event`](https://developer.mozilla.org/en-US/docs/Web/API/Event) [`ErrorEvent`](https://developer.mozilla.org/en-US/docs/Web/API/ErrorEvent) [`CloseEvent`](https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent) [`MessageEvent`](https://developer.mozilla.org/en-US/docs/Web/API/MessageEvent)

---

{% /table %}

## Bun APIs

Bun exposes a set of Bun-specific APIs on the `Bun` global object and through a number of built-in modules. These APIs represent the canonical "Bun-native" way to perform some common development tasks. They are all heavily optimized for performance. Click the link in the left column to view the associated documentation.

{% table %}

- Topic
- APIs

---

- [HTTP](https://bun.com/docs/api/http)
- `Bun.serve`

---

- [File I/O](https://bun.com/docs/api/file-io)
- `Bun.file` `Bun.write`

---

- [Processes](https://bun.com/docs/api/spawn)
- `Bun.spawn` `Bun.spawnSync`

---

- [TCP](https://bun.com/docs/api/tcp)
- `Bun.listen` `Bun.connect`

---

- [Transpiler](https://bun.com/docs/api/transpiler)
- `Bun.Transpiler`

---

- [Routing](https://bun.com/docs/api/file-system-router)
- `Bun.FileSystemRouter`

---

- [HTMLRewriter](https://bun.com/docs/api/html-rewriter)
- `HTMLRewriter`

---

- [Utils](https://bun.com/docs/api/utils)
- `Bun.peek` `Bun.which`

---

- [SQLite](https://bun.com/docs/api/sqlite)
- `bun:sqlite`

---

- [FFI](https://bun.com/docs/api/ffi)
- `bun:ffi`

---

- [DNS](https://bun.com/docs/api/dns)
- `bun:dns`

---

- [Testing](https://bun.com/docs/api/test)
- `bun:test`

---

- [Node-API](https://bun.com/docs/api/node-api)
- `Node-API`

---

{% /table %}

## Plugins

Support for additional file types can be implemented with plugins. Refer to [Runtime > Plugins](https://bun.com/docs/bundler/plugins) for full documentation.
