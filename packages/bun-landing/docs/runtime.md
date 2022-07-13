## Using bun.js - a new JavaScript runtime environment

bun.js focuses on performance, developer experience and compatibility with the JavaScript ecosystem.

```ts
// http.ts
export default {
  port: 3000,
  fetch(request: Request) {
    return new Response("Hello World");
  },
};

// bun ./http.ts
```

| Requests per second                                                    | OS    | CPU                            | bun version |
| ---------------------------------------------------------------------- | ----- | ------------------------------ | ----------- |
| [260,000](https://twitter.com/jarredsumner/status/1512040623200616449) | macOS | Apple Silicon M1 Max           | 0.0.76      |
| [160,000](https://twitter.com/jarredsumner/status/1511988933587976192) | Linux | AMD Ryzen 5 3600 6-Core 2.2ghz | 0.0.76      |

<details>
<summary>Measured with <a target="_blank" href="https://github.com/uNetworking/uSockets/blob/master/examples/http_load_test.c">http_load_test</a></summary> by running:

```bash
./http_load_test  20 127.0.0.1 3000
```

</details>

bun.js prefers Web API compatibility instead of designing new APIs when possible. bun.js also implements some Node.js APIs.

- TypeScript & JSX support is builtin, powered by Bun's JavaScript transpiler
- ESM & CommonJS modules are supported (internally, bun.js uses ESM)
- Many npm packages "just work" with bun.js (when they use few/no node APIs)
- tsconfig.json `"paths"` is natively supported, along with `"exports"` in package.json
- `fs`, `path`, and `process` from Node are partially implemented
- Web APIs like [`fetch`](https://developer.mozilla.org/en-US/docs/Web/API/fetch), [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response), [`URL`](https://developer.mozilla.org/en-US/docs/Web/API/URL) and more are builtin
- [`HTMLRewriter`](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/) makes it easy to transform HTML in bun.js
- Starts [4x faster than Node](https://twitter.com/jarredsumner/status/1499225725492076544) (try it yourself)
- `.env` files automatically load into `process.env` and `Bun.env`
- top level await

The runtime uses JavaScriptCore, the JavaScript engine powering WebKit and Safari. Some web APIs like [`Headers`](https://developer.mozilla.org/en-US/docs/Web/API/Headers) and [`URL`](https://developer.mozilla.org/en-US/docs/Web/API/URL) directly use [Safari's implementation](https://github.com/Jarred-Sumner/bun/blob/HEAD/src/bun.js/bindings/webcore/JSFetchHeaders.cpp).

`cat` clone that runs [2x faster than GNU cat](https://twitter.com/jarredsumner/status/1511707890708586496) for large files on Linux

```js
// cat.js
import { resolve } from "path";
import { write, stdout, file, argv } from "bun";

const path = resolve(argv.at(-1));

await write(
  // stdout is a Blob
  stdout,
  // file(path) returns a Blob - https://developer.mozilla.org/en-US/docs/Web/API/Blob
  file(path)
);

// bun ./cat.js ./path-to-file
```

Server-side render React:

```js
// requires Bun v0.1.0 or later
// react-ssr.tsx
import { renderToReadableStream } from "react-dom/server";

const dt = new Intl.DateTimeFormat();

export default {
  port: 3000,
  async fetch(request: Request) {
    return new Response(
      await renderToReadableStream(
        <html>
          <head>
            <title>Hello World</title>
          </head>
          <body>
            <h1>Hello from React!</h1>
            <p>The date is {dt.format(new Date())}</p>
          </body>
        </html>
      )
    );
  },
};

// bun react-ssr.tsx
```

There are some more examples in the [examples](./examples) folder.

PRs adding more examples are very welcome!
