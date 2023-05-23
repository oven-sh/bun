## Node.js built-ins (`node:http` and `node:https`)

Bun implements the Node.js [`http`](https://nodejs.org/api/http.html) and [`https`](https://nodejs.org/api/https.html) modules. These modules have been re-implemented to use Bun's fast internal HTTP infrastructure. Feel free to use these modules directly; frameworks like [Express](https://expressjs.com/) that depend on these modules should work out of the box. For granular compatibility information, see [Runtime > Node.js APIs](/docs/runtime/nodejs-apis).

For better performance and a cleaner API, we recommend using [`Bun.serve`](#start-a-server-bun-serve) (documented below).

## Send a request (`fetch()`)

Bun implements the Web `fetch` API for making HTTP requests. The `fetch` function is available in the global scope.

```ts
const response = await fetch("https://bun.sh/manifest.json");
const result = (await response.json()) as any;
console.log(result.icons[0].src);
// => "/logo-square.jpg"
```

## Start a server (`Bun.serve()`)

Start an HTTP server in Bun with `Bun.serve`.

```ts
Bun.serve({
  fetch(req) {
    return new Response(`Bun!`);
  },
});
```

The `fetch` handler handles incoming requests. It receives a [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request) object and returns a [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response) or `Promise<Response>`.

```ts
Bun.serve({
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/") return new Response(`Home page!`);
    if (url.pathname === "/blog") return new Response("Blog!");
    return new Response(`404!`);
  },
});
```

To configure which port and hostname the server will listen on:

```ts
Bun.serve({
  port: 8080, // defaults to $PORT, then 3000
  hostname: "mydomain.com", // defaults to "0.0.0.0"
  fetch(req) {
    return new Response(`404!`);
  },
});
```

### Error handling

To activate development mode, set `development: true`. By default, development mode is _enabled_ unless `NODE_ENV` is `production`.

```ts
Bun.serve({
  development: true,
  fetch(req) {
    throw new Error("woops!");
  },
});
```

In development mode, Bun will surface errors in-browser with a built-in error page.

{% image src="/images/exception_page.png" caption="Bun's built-in 500 page" /%}

To handle server-side errors, implement an `error` handler. This function should return a `Response` to served to the client when an error occurs. This response will supercede Bun's default error page in `development` mode.

```ts
Bun.serve({
  fetch(req) {
    throw new Error("woops!");
  },
  error(error: Error) {
    return new Response(`<pre>${error}\n${error.stack}</pre>`, {
      headers: {
        "Content-Type": "text/html",
      },
    });
  },
});
```

{% callout %}
**Note** — Full debugger support is planned.
{% /callout %}

The call to `Bun.serve` returns a `Server` object. To stop the server, call the `.stop()` method.

```ts
const server = Bun.serve({
  fetch() {
    return new Response("Bun!");
  },
});

server.stop();
```

### TLS

Bun supports TLS out of the box, powered by [OpenSSL](https://www.openssl.org/). Enable TLS by passing in a value for `key` and `cert`; both are required to enable TLS. If needed, supply a `passphrase` to decrypt the `keyFile`.

```ts
Bun.serve({
  fetch(req) {
    return new Response("Hello!!!");
  },

  // can be string, BunFile, TypedArray, Buffer, or array thereof
  key: Bun.file("./key.pem"),
  cert: Bun.file("./cert.pem"),

  // passphrase, only required if key is encrypted
  passphrase: "super-secret",
});
```

The `key` and `cert` fields expect the _contents_ of your TLS key and certificate. This can be a string, `BunFile`, `TypedArray`, or `Buffer`.

```ts
Bun.serve({
  fetch() {},

  // BunFile
  key: Bun.file("./key.pem"),
  // Buffer
  key: fs.readFileSync("./key.pem"),
  // string
  key: fs.readFileSync("./key.pem", "utf8"),
  // array
  key: [Bun.file('./key1.pem'), Bun.file('./key2.pem']
});
```

Earlier versions of Bun supported passing a file path as `keyFile` and `certFile`; this has been deprecated as of `v0.6.3`.

```ts
// deprecated 🚧
Bun.serve({
  fetch() {
    /* ... */
  },
  keyFile: "/path/to/key.pem", // path to TLS key
  certFile: "/path/to/cert.pem", // path to TLS cert
});
```

Optionally, you can override the trusted CA certificates by passing a value for `ca`. By default, the server will trust the list of well-known CAs curated by Mozilla. When `ca` is specified, the Mozilla list is overwritten.

```ts
Bun.serve({
  fetch(req) {
    return new Response("Hello!!!");
  },
  key: Bun.file("./key.pem"), // path to TLS key
  cert: Bun.file("./cert.pem"), // path to TLS cert
  ca: Bun.file("./ca.pem"), // path to root CA certificate
});
```

To override Diffie-Helman parameters:

```ts
Bun.serve({
  // ...
  dhParamsFile: "./dhparams.pem", // path to Diffie Helman parameters
});
```

### Hot reloading

Thus far, the examples on this page have used the explicit `Bun.serve` API. Bun also supports an alternate syntax.

```ts#server.ts
import {type Serve} from "bun";

export default {
  fetch(req) {
    return new Response(`Bun!`);
  },
} satisfies Serve;
```

Instead of passing the server options into `Bun.serve`, export it. This file can be executed as-is; when Bun runs a file with a `default` export containing a `fetch` handler, it passes it into `Bun.serve` under the hood.

This syntax has one major advantage: it is hot-reloadable out of the box. When any source file is changed, Bun will reload the server with the updated code _without restarting the process_. This makes hot reloads nearly instantaneous. Use the `--hot` flag when starting the server to enable hot reloading.

```bash
$ bun --hot server.ts
```

It's possible to configure hot reloading while using the explicit `Bun.serve` API; for details refer to [Runtime > Hot reloading](/docs/runtime/hot).

### Streaming files

To stream a file, return a `Response` object with a `BunFile` object as the body.

```ts
import { serve, file } from "bun";

serve({
  fetch(req) {
    return new Response(Bun.file("./hello.txt"));
  },
});
```

{% callout %}
⚡️ **Speed** — Bun automatically uses the [`sendfile(2)`](https://man7.org/linux/man-pages/man2/sendfile.2.html) system call when possible, enabling zero-copy file transfers in the kernel—the fastest way to send files.
{% /callout %}

**[v0.3.0+]** You can send part of a file using the [`slice(start, end)`](https://developer.mozilla.org/en-US/docs/Web/API/Blob/slice) method on the `Bun.file` object. This automatically sets the `Content-Range` and `Content-Length` headers on the `Response` object.

```ts
Bun.serve({
  fetch(req) {
    // parse `Range` header
    const [start = 0, end = Infinity] = req.headers
      .get("Range") // Range: bytes=0-100
      .split("=") // ["Range: bytes", "0-100"]
      .at(-1) // "0-100"
      .split("-") // ["0", "100"]
      .map(Number); // [0, 100]

    // return a slice of the file
    const bigFile = Bun.file("./big-video.mp4");
    return new Response(bigFile.slice(start, end));
  },
});
```

### Benchmarks

Below are Bun and Node.js implementations of a simple HTTP server that responds `Bun!` to each incoming `Request`.

{% codetabs %}

```ts#Bun
Bun.serve({
  fetch(req: Request) {
    return new Response(`Bun!`);
  },
  port: 3000,
});
```

```ts#Node
require("http")
  .createServer((req, res) => res.end("Bun!"))
  .listen(8080);
```

{% /codetabs %}
The `Bun.serve` server can handle roughly 2.5x more requests per second than Node.js on Linux.

{% table %}

- Runtime
- Requests per second

---

- Node 16
- ~64,000

---

- Bun
- ~160,000

{% /table %}

{% image width="499" alt="image" src="https://user-images.githubusercontent.com/709451/162389032-fc302444-9d03-46be-ba87-c12bd8ce89a0.png" /%}

### Reference

{% details summary="See TypeScript definitions" %}

```ts
interface Bun {
  serve(options: {
    fetch: (req: Request, server: Server) => Response | Promise<Response>;
    hostname?: string;
    port?: number;
    development?: boolean;
    error?: (error: Error) => Response | Promise<Response>;
    keyFile?: string;
    certFile?: string;
    caFile?: string;
    dhParamsFile?: string;
    passphrase?: string;
    maxRequestBodySize?: number;
    lowMemoryMode?: boolean;
  }): Server;
}

interface Server {
  development: boolean;
  hostname: string;
  port: number;
  pendingRequests: number;
  stop(): void;
}
```

{% /details %}
