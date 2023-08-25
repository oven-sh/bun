The page primarily documents the Bun-native `Bun.serve` API. Bun also implements [`fetch`](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API) and the Node.js [`http`](https://nodejs.org/api/http.html) and [`https`](https://nodejs.org/api/https.html) modules.

{% callout %}
These modules have been re-implemented to use Bun's fast internal HTTP infrastructure. Feel free to use these modules directly; frameworks like [Express](https://expressjs.com/) that depend on these modules should work out of the box. For granular compatibility information, see [Runtime > Node.js APIs](/docs/runtime/nodejs-apis).
{% /callout %}

To start a high-performance HTTP server with a clean API, the recommended approach is [`Bun.serve`](#start-a-server-bun-serve).

## `Bun.serve()`

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
  port: 8080, // defaults to $BUN_PORT, $PORT, $NODE_PORT otherwise 3000
  hostname: "mydomain.com", // defaults to "0.0.0.0"
  fetch(req) {
    return new Response(`404!`);
  },
});
```

To listen on a [unix domain socket](https://en.wikipedia.org/wiki/Unix_domain_socket):

```ts
Bun.serve({
  unix: "/tmp/my-socket.sock", // path to socket
  fetch(req) {
    return new Response(`404!`);
  },
});
```

## Error handling

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
  error(error) {
    return new Response(`<pre>${error}\n${error.stack}</pre>`, {
      headers: {
        "Content-Type": "text/html",
      },
    });
  },
});
```

{% callout %}
[Learn more about debugging in Bun](https://bun.sh/docs/runtime/debugger)
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

## TLS

Bun supports TLS out of the box, powered by [BoringSSL](https://boringssl.googlesource.com/boringssl). Enable TLS by passing in a value for `key` and `cert`; both are required to enable TLS.

```ts-diff
  Bun.serve({
    fetch(req) {
      return new Response("Hello!!!");
    },

+   tls: {
+     key: Bun.file("./key.pem"),
+     cert: Bun.file("./cert.pem"),
+   }
  });
```

The `key` and `cert` fields expect the _contents_ of your TLS key and certificate, _not a path to it_. This can be a string, `BunFile`, `TypedArray`, or `Buffer`.

```ts
Bun.serve({
  fetch() {},

  tls: {
    // BunFile
    key: Bun.file("./key.pem"),
    // Buffer
    key: fs.readFileSync("./key.pem"),
    // string
    key: fs.readFileSync("./key.pem", "utf8"),
    // array of above
    key: [Bun.file("./key1.pem"), Bun.file("./key2.pem")],
  },
});
```

{% callout %}

**Note** — Earlier versions of Bun supported passing a file path as `keyFile` and `certFile`; this has been deprecated as of `v0.6.3`.

{% /callout %}

If your private key is encrypted with a passphrase, provide a value for `passphrase` to decrypt it.

```ts-diff
  Bun.serve({
    fetch(req) {
      return new Response("Hello!!!");
    },

    tls: {
      key: Bun.file("./key.pem"),
      cert: Bun.file("./cert.pem"),
+     passphrase: "my-secret-passphrase",
    }
  });
```

Optionally, you can override the trusted CA certificates by passing a value for `ca`. By default, the server will trust the list of well-known CAs curated by Mozilla. When `ca` is specified, the Mozilla list is overwritten.

```ts-diff
  Bun.serve({
    fetch(req) {
      return new Response("Hello!!!");
    },
    tls: {
      key: Bun.file("./key.pem"), // path to TLS key
      cert: Bun.file("./cert.pem"), // path to TLS cert
+     ca: Bun.file("./ca.pem"), // path to root CA certificate
    }
  });
```

To override Diffie-Helman parameters:

```ts
Bun.serve({
  // ...
  tls: {
    // other config
    dhParamsFile: "/path/to/dhparams.pem", // path to Diffie Helman parameters
  },
});
```

## Hot reloading

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

## Streaming files

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

## Benchmarks

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

## Reference

{% details summary="See TypeScript definitions" %}

```ts
interface Bun {
  serve(options: {
    fetch: (req: Request, server: Server) => Response | Promise<Response>;
    hostname?: string;
    port?: number;
    development?: boolean;
    error?: (error: Error) => Response | Promise<Response>;
    tls?: {
      key?:
        | string
        | TypedArray
        | BunFile
        | Array<string | TypedArray | BunFile>;
      cert?:
        | string
        | TypedArray
        | BunFile
        | Array<string | TypedArray | BunFile>;
      ca?: string | TypedArray | BunFile | Array<string | TypedArray | BunFile>;
      passphrase?: string;
      dhParamsFile?: string;
    };
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
