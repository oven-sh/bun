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
    return new Response("Bun!");
  },
});
```

### `fetch` request handler

The `fetch` handler handles incoming requests. It receives a [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request) object and returns a [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response) or `Promise<Response>`.

```ts
Bun.serve({
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/") return new Response("Home page!");
    if (url.pathname === "/blog") return new Response("Blog!");
    return new Response("404!");
  },
});
```

The `fetch` handler supports async/await:

```ts
import { sleep, serve } from "bun";
serve({
  async fetch(req) {
    const start = performance.now();
    await sleep(10);
    const end = performance.now();
    return new Response(`Slept for ${end - start}ms`);
  },
});
```

Promise-based responses are also supported:

```ts
Bun.serve({
  fetch(req) {
    // Forward the request to another server.
    return fetch("https://example.com");
  },
});
```

You can also access the `Server` object from the `fetch` handler. It's the second argument passed to the `fetch` function.

```ts
// `server` is passed in as the second argument to `fetch`.
const server = Bun.serve({
  fetch(req, server) {
    const ip = server.requestIP(req);
    return new Response(`Your IP is ${ip}`);
  },
});
```

### Changing the `port` and `hostname`

To configure which port and hostname the server will listen on, set `port` and `hostname` in the options object.

```ts
Bun.serve({
  port: 8080, // defaults to $BUN_PORT, $PORT, $NODE_PORT otherwise 3000
  hostname: "mydomain.com", // defaults to "0.0.0.0"
  fetch(req) {
    return new Response("404!");
  },
});
```

To randomly select an available port, set `port` to `0`.

```ts
const server = Bun.serve({
  port: 0, // random port
  fetch(req) {
    return new Response("404!");
  },
});

// server.port is the randomly selected port
console.log(server.port);
```

You can view the chosen port by accessing the `port` property on the server object, or by accessing the `url` property.

```ts
console.log(server.port); // 3000
console.log(server.url); // http://localhost:3000
```

#### Configuring a default port

Bun supports several options and environment variables to configure the default port. The default port is used when the `port` option is not set.

- `--port` CLI flag

```sh
$ bun --port=4002 server.ts
```

- `BUN_PORT` environment variable

```sh
$ BUN_PORT=4002 bun server.ts
```

- `PORT` environment variable

```sh
$ PORT=4002 bun server.ts
```

- `NODE_PORT` environment variable

```sh
$ NODE_PORT=4002 bun server.ts
```

### Unix domain sockets

To listen on a [unix domain socket](https://en.wikipedia.org/wiki/Unix_domain_socket), pass the `unix` option with the path to the socket.

```ts
Bun.serve({
  unix: "/tmp/my-socket.sock", // path to socket
  fetch(req) {
    return new Response(`404!`);
  },
});
```

### Abstract namespace sockets

Bun supports Linux abstract namespace sockets. To use an abstract namespace socket, prefix the `unix` path with a null byte.

```ts
Bun.serve({
  unix: "\0my-abstract-socket", // abstract namespace socket
  fetch(req) {
    return new Response(`404!`);
  },
});
```

Unlike unix domain sockets, abstract namespace sockets are not bound to the filesystem and are automatically removed when the last reference to the socket is closed.

## Error handling

To activate development mode, set `development: true`.

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

### `error` callback

To handle server-side errors, implement an `error` handler. This function should return a `Response` to serve to the client when an error occurs. This response will supersede Bun's default error page in `development` mode.

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

To override Diffie-Hellman parameters:

```ts
Bun.serve({
  // ...
  tls: {
    // other config
    dhParamsFile: "/path/to/dhparams.pem", // path to Diffie Hellman parameters
  },
});
```

### Sever name indication (SNI)

To configure the server name indication (SNI) for the server, set the `serverName` field in the `tls` object.

```ts
Bun.serve({
  // ...
  tls: {
    // ... other config
    serverName: "my-server.com", // SNI
  },
});
```

To allow multiple server names, pass an array of objects to `tls`, each with a `serverName` field.

```ts
Bun.serve({
  // ...
  tls: [
    {
      key: Bun.file("./key1.pem"),
      cert: Bun.file("./cert1.pem"),
      serverName: "my-server1.com",
    },
    {
      key: Bun.file("./key2.pem"),
      cert: Bun.file("./cert2.pem"),
      serverName: "my-server2.com",
    },
  ],
});
```

## Object syntax

Thus far, the examples on this page have used the explicit `Bun.serve` API. Bun also supports an alternate syntax.

```ts#server.ts
import {type Serve} from "bun";

export default {
  fetch(req) {
    return new Response("Bun!");
  },
} satisfies Serve;
```

Instead of passing the server options into `Bun.serve`, `export default` it. This file can be executed as-is; when Bun sees a file with a `default` export containing a `fetch` handler, it passes it into `Bun.serve` under the hood.

<!-- This syntax has one major advantage: it is hot-reloadable out of the box. When any source file is changed, Bun will reload the server with the updated code _without restarting the process_. This makes hot reloads nearly instantaneous. Use the `--hot` flag when starting the server to enable hot reloading. -->

<!-- ```bash
$ bun --hot server.ts
``` -->

<!-- It's possible to configure hot reloading while using the explicit `Bun.serve` API; for details refer to [Runtime > Hot reloading](/docs/runtime/hot). -->

## Streaming files

To stream a file, return a `Response` object with a `BunFile` object as the body.

```ts
Bun.serve({
  fetch(req) {
    return new Response(Bun.file("./hello.txt"));
  },
});
```

{% callout %}
⚡️ **Speed** — Bun automatically uses the [`sendfile(2)`](https://man7.org/linux/man-pages/man2/sendfile.2.html) system call when possible, enabling zero-copy file transfers in the kernel—the fastest way to send files.
{% /callout %}

You can send part of a file using the [`slice(start, end)`](https://developer.mozilla.org/en-US/docs/Web/API/Blob/slice) method on the `Bun.file` object. This automatically sets the `Content-Range` and `Content-Length` headers on the `Response` object.

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
    return new Response("Bun!");
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
    development?: boolean;
    error?: (
      request: ErrorLike,
    ) => Response | Promise<Response> | undefined | Promise<undefined>;
    fetch(request: Request, server: Server): Response | Promise<Response>;
    hostname?: string;
    id?: string | null;
    maxRequestBodySize?: number;
    port?: string | number;
    reusePort?: boolean;
    tls?: TLSOptions | Array<TLSOptions>;
    unix: string;
    websocket: WebSocketHandler<WebSocketDataType>;
  }): Server;
}

interface TLSOptions {
  ca?: string | Buffer | BunFile | Array<string | Buffer | BunFile> | undefined;
  cert?:
    | string
    | Buffer
    | BunFile
    | Array<string | Buffer | BunFile>
    | undefined;
  dhParamsFile?: string;
  key?:
    | string
    | Buffer
    | BunFile
    | Array<string | Buffer | BunFile>
    | undefined;
  lowMemoryMode?: boolean;
  passphrase?: string;
  secureOptions?: number | undefined;
  serverName?: string;
}

interface WebSocketHandler<T = undefined> {
  backpressureLimit?: number;
  close?(
    ws: ServerWebSocket<T>,
    code: number,
    reason: string,
  ): void | Promise<void>;
  closeOnBackpressureLimit?: boolean;
  drain?(ws: ServerWebSocket<T>): void | Promise<void>;
  idleTimeout?: number;
  maxPayloadLength?: number;
  message(
    ws: ServerWebSocket<T>,
    message: string | Buffer,
  ): void | Promise<void>;
  open?(ws: ServerWebSocket<T>): void | Promise<void>;
  perMessageDeflate?:
    | boolean
    | {
        compress?: WebSocketCompressor | boolean;
        decompress?: WebSocketCompressor | boolean;
      };
  ping?(ws: ServerWebSocket<T>, data: Buffer): void | Promise<void>;
  pong?(ws: ServerWebSocket<T>, data: Buffer): void | Promise<void>;
  publishToSelf?: boolean;
  sendPings?: boolean;
}

interface Server {
  fetch(request: Request | string): Response | Promise<Response>;
  publish(
    compress?: boolean,
    data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer,
    topic: string,
  ): ServerWebSocketSendStatus;
  ref(): void;
  reload(options: Serve): void;
  requestIP(request: Request): SocketAddress | null;
  stop(closeActiveConnections?: boolean): void;
  unref(): void;
  upgrade<T = undefined>(
    options?: {
      data?: T;
      headers?: Bun.HeadersInit;
    },
    request: Request,
  ): boolean;

  readonly development: boolean;
  readonly hostname: string;
  readonly id: string;
  readonly pendingRequests: number;
  readonly pendingWebSockets: number;
  readonly port: number;
  readonly url: URL;
}
```

{% /details %}
