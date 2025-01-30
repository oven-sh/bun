The page primarily documents the Bun-native `Bun.serve` API. Bun also implements [`fetch`](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API) and the Node.js [`http`](https://nodejs.org/api/http.html) and [`https`](https://nodejs.org/api/https.html) modules.

{% callout %}
These modules have been re-implemented to use Bun's fast internal HTTP infrastructure. Feel free to use these modules directly; frameworks like [Express](https://expressjs.com/) that depend on these modules should work out of the box. For granular compatibility information, see [Runtime > Node.js APIs](https://bun.sh/docs/runtime/nodejs-apis).
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

### Static routes

Use the `static` option to serve static `Response` objects by route.

```ts
// Bun v1.1.27+ required
Bun.serve({
  static: {
    // health-check endpoint
    "/api/health-check": new Response("All good!"),

    // redirect from /old-link to /new-link
    "/old-link": Response.redirect("/new-link", 301),

    // serve static text
    "/": new Response("Hello World"),

    // serve a file by buffering it in memory
    "/index.html": new Response(await Bun.file("./index.html").bytes(), {
      headers: {
        "Content-Type": "text/html",
      },
    }),
    "/favicon.ico": new Response(await Bun.file("./favicon.ico").bytes(), {
      headers: {
        "Content-Type": "image/x-icon",
      },
    }),

    // serve JSON
    "/api/version.json": Response.json({ version: "1.0.0" }),
  },

  fetch(req) {
    return new Response("404!");
  },
});
```

Static routes support headers, status code, and other `Response` options.

```ts
Bun.serve({
  static: {
    "/api/time": new Response(new Date().toISOString(), {
      headers: {
        "X-Custom-Header": "Bun!",
      },
    }),
  },

  fetch(req) {
    return new Response("404!");
  },
});
```

Static routes can serve Response bodies faster than `fetch` handlers because they don't create `Request` objects, they don't create `AbortSignal`, they don't create additional `Response` objects. The only per-request memory allocation is the TCP/TLS socket data needed for each request.

{% note %}
`static` is experimental
{% /note %}

Static route responses are cached for the lifetime of the server object. To reload static routes, call `server.reload(options)`.

```ts
const server = Bun.serve({
  static: {
    "/api/time": new Response(new Date().toISOString()),
  },

  fetch(req) {
    return new Response("404!");
  },
});

// Update the time every second.
setInterval(() => {
  server.reload({
    static: {
      "/api/time": new Response(new Date().toISOString()),
    },

    fetch(req) {
      return new Response("404!");
    },
  });
}, 1000);
```

Reloading static routes only impact the next request. In-flight requests continue to use the old static routes. After in-flight requests to old static routes are finished, the old static routes are freed from memory.

To simplify error handling, static routes do not support streaming response bodies from `ReadableStream` or an `AsyncIterator`. Fortunately, you can still buffer the response in memory first:

```ts
const time = await fetch("https://api.example.com/v1/data");
// Buffer the response in memory first.
const blob = await time.blob();

const server = Bun.serve({
  static: {
    "/api/data": new Response(blob),
  },

  fetch(req) {
    return new Response("404!");
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

### Server name indication (SNI)

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

## idleTimeout

To configure the idle timeout, set the `idleTimeout` field in Bun.serve.

```ts
Bun.serve({
  // 10 seconds:
  idleTimeout: 10,

  fetch(req) {
    return new Response("Bun!");
  },
});
```

This is the maximum amount of time a connection is allowed to be idle before the server closes it. A connection is idling if there is no data sent or received.

## export default syntax

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

<!-- It's possible to configure hot reloading while using the explicit `Bun.serve` API; for details refer to [Runtime > Hot reloading](https://bun.sh/docs/runtime/hot). -->

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

## Server Lifecycle Methods

### server.stop() - Stop the server

To stop the server from accepting new connections:

```ts
const server = Bun.serve({
  fetch(req) {
    return new Response("Hello!");
  },
});

// Gracefully stop the server (waits for in-flight requests)
await server.stop();

// Force stop and close all active connections
await server.stop(true);
```

By default, `stop()` allows in-flight requests and WebSocket connections to complete. Pass `true` to immediately terminate all connections.

### server.ref() and server.unref() - Process lifecycle control

Control whether the server keeps the Bun process alive:

```ts
// Don't keep process alive if server is the only thing running
server.unref();

// Restore default behavior - keep process alive
server.ref();
```

### server.reload() - Hot reload handlers

Update the server's handlers without restarting:

```ts
const server = Bun.serve({
  static: {
    "/api/version": Response.json({ version: "v1" }),
  },
  fetch(req) {
    return new Response("v1");
  },
});

// Update to new handler
server.reload({
  static: {
    "/api/version": Response.json({ version: "v2" }),
  },
  fetch(req) {
    return new Response("v2");
  },
});
```

This is useful for development and hot reloading. Only `fetch`, `error`, and `static` handlers can be updated.

## Per-Request Controls

<!-- ### server.abort(Request) - Abort requests

The `server.abort(request: Request)` method:

- Returns `true` if request was aborted, `false` if already aborted/completed
- Triggers the request's `AbortSignal`
- Cancels any attached `ReadableStream`
- Rejects any pending body promises (like `.text()`)

```ts
const server = Bun.serve({
  fetch(req, server) {
    // abort if the url contains "slow"
    if (req.url.includes("slow")) {
      server.abort(req);

      // When aborted, the server will not error due to the lack of a `Response` object
      // If you return a `Response` anyway, it will be ignored.
      return;
    }

    return new Response("Processing...");
  },
});
``` -->

### server.timeout(Request, seconds) - Custom request timeouts

Set a custom idle timeout for individual requests:

```ts
const server = Bun.serve({
  fetch(req, server) {
    // Set 60 second timeout for this request
    server.timeout(req, 60);

    // If they take longer than 60 seconds to send the body, the request will be aborted
    await req.text();

    return new Response("Done!");
  },
});
```

Pass `0` to disable the timeout for a request.

### server.requestIP(Request) - Get client information

Get client IP and port information:

```ts
const server = Bun.serve({
  fetch(req, server) {
    const address = server.requestIP(req);
    if (address) {
      return new Response(
        `Client IP: ${address.address}, Port: ${address.port}`,
      );
    }
    return new Response("Unknown client");
  },
});
```

Returns `null` for closed requests or Unix domain sockets.

## Server Metrics

### server.pendingRequests and server.pendingWebSockets

Monitor server activity with built-in counters:

```ts
const server = Bun.serve({
  fetch(req, server) {
    return new Response(
      `Active requests: ${server.pendingRequests}\n` +
        `Active WebSockets: ${server.pendingWebSockets}`,
    );
  },
});
```

### server.subscriberCount(topic) - WebSocket subscribers

Get count of subscribers for a WebSocket topic:

```ts
const server = Bun.serve({
  fetch(req, server) {
    const chatUsers = server.subscriberCount("chat");
    return new Response(`${chatUsers} users in chat`);
  },
  websocket: {
    message(ws) {
      ws.subscribe("chat");
    },
  },
});
```

## WebSocket Configuration

### server.publish(topic, data, compress) - WebSocket Message Publishing

The server can publish messages to all WebSocket clients subscribed to a topic:

```ts
const server = Bun.serve({
  websocket: {
    message(ws) {
      // Publish to all "chat" subscribers
      server.publish("chat", "Hello everyone!");
    },
  },

  fetch(req) {
    // ...
  },
});
```

The `publish()` method returns:

- Number of bytes sent if successful
- `0` if the message was dropped
- `-1` if backpressure was applied

### WebSocket Handler Options

When configuring WebSockets, several advanced options are available through the `websocket` handler:

```ts
Bun.serve({
  websocket: {
    // Maximum message size (in bytes)
    maxPayloadLength: 64 * 1024,

    // Backpressure limit before messages are dropped
    backpressureLimit: 1024 * 1024,

    // Close connection if backpressure limit is hit
    closeOnBackpressureLimit: true,

    // Handler called when backpressure is relieved
    drain(ws) {
      console.log("Backpressure relieved");
    },

    // Enable per-message deflate compression
    perMessageDeflate: {
      compress: true,
      decompress: true,
    },

    // Send ping frames to keep connection alive
    sendPings: true,

    // Handlers for ping/pong frames
    ping(ws, data) {
      console.log("Received ping");
    },
    pong(ws, data) {
      console.log("Received pong");
    },

    // Whether server receives its own published messages
    publishToSelf: false,
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
interface Server extends Disposable {
  /**
   * Stop the server from accepting new connections.
   * @param closeActiveConnections If true, immediately terminates all connections
   * @returns Promise that resolves when the server has stopped
   */
  stop(closeActiveConnections?: boolean): Promise<void>;

  /**
   * Update handlers without restarting the server.
   * Only fetch and error handlers can be updated.
   */
  reload(options: Serve): void;

  /**
   * Make a request to the running server.
   * Useful for testing or internal routing.
   */
  fetch(request: Request | string): Response | Promise<Response>;

  /**
   * Upgrade an HTTP request to a WebSocket connection.
   * @returns true if upgrade successful, false if failed
   */
  upgrade<T = undefined>(
    request: Request,
    options?: {
      headers?: Bun.HeadersInit;
      data?: T;
    },
  ): boolean;

  /**
   * Publish a message to all WebSocket clients subscribed to a topic.
   * @returns Bytes sent, 0 if dropped, -1 if backpressure applied
   */
  publish(
    topic: string,
    data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer,
    compress?: boolean,
  ): ServerWebSocketSendStatus;

  /**
   * Get count of WebSocket clients subscribed to a topic.
   */
  subscriberCount(topic: string): number;

  /**
   * Get client IP address and port.
   * @returns null for closed requests or Unix sockets
   */
  requestIP(request: Request): SocketAddress | null;

  /**
   * Set custom idle timeout for a request.
   * @param seconds Timeout in seconds, 0 to disable
   */
  timeout(request: Request, seconds: number): void;

  /**
   * Keep process alive while server is running.
   */
  ref(): void;

  /**
   * Allow process to exit if server is only thing running.
   */
  unref(): void;

  /** Number of in-flight HTTP requests */
  readonly pendingRequests: number;

  /** Number of active WebSocket connections */
  readonly pendingWebSockets: number;

  /** Server URL including protocol, hostname and port */
  readonly url: URL;

  /** Port server is listening on */
  readonly port: number;

  /** Hostname server is bound to */
  readonly hostname: string;

  /** Whether server is in development mode */
  readonly development: boolean;

  /** Server instance identifier */
  readonly id: string;
}

interface WebSocketHandler<T = undefined> {
  /** Maximum WebSocket message size in bytes */
  maxPayloadLength?: number;

  /** Bytes of queued messages before applying backpressure */
  backpressureLimit?: number;

  /** Whether to close connection when backpressure limit hit */
  closeOnBackpressureLimit?: boolean;

  /** Called when backpressure is relieved */
  drain?(ws: ServerWebSocket<T>): void | Promise<void>;

  /** Seconds before idle timeout */
  idleTimeout?: number;

  /** Enable per-message deflate compression */
  perMessageDeflate?:
    | boolean
    | {
        compress?: WebSocketCompressor | boolean;
        decompress?: WebSocketCompressor | boolean;
      };

  /** Send ping frames to keep connection alive */
  sendPings?: boolean;

  /** Whether server receives its own published messages */
  publishToSelf?: boolean;

  /** Called when connection opened */
  open?(ws: ServerWebSocket<T>): void | Promise<void>;

  /** Called when message received */
  message(
    ws: ServerWebSocket<T>,
    message: string | Buffer,
  ): void | Promise<void>;

  /** Called when connection closed */
  close?(
    ws: ServerWebSocket<T>,
    code: number,
    reason: string,
  ): void | Promise<void>;

  /** Called when ping frame received */
  ping?(ws: ServerWebSocket<T>, data: Buffer): void | Promise<void>;

  /** Called when pong frame received */
  pong?(ws: ServerWebSocket<T>, data: Buffer): void | Promise<void>;
}

interface TLSOptions {
  /** Certificate authority chain */
  ca?: string | Buffer | BunFile | Array<string | Buffer | BunFile>;

  /** Server certificate */
  cert?: string | Buffer | BunFile | Array<string | Buffer | BunFile>;

  /** Path to DH parameters file */
  dhParamsFile?: string;

  /** Private key */
  key?: string | Buffer | BunFile | Array<string | Buffer | BunFile>;

  /** Reduce TLS memory usage */
  lowMemoryMode?: boolean;

  /** Private key passphrase */
  passphrase?: string;

  /** OpenSSL options flags */
  secureOptions?: number;

  /** Server name for SNI */
  serverName?: string;
}
```

{% /details %}
