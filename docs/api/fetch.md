Bun implements the WHATWG `fetch` standard, with some extensions to meet the needs of server-side JavaScript.

Bun also implements `node:http`, but `fetch` is generally recommended instead.

## Sending an HTTP request

To send an HTTP request, use `fetch`

```ts
const response = await fetch("http://example.com");

console.log(response.status); // => 200

const text = await response.text(); // or response.json(), response.formData(), etc.
```

`fetch` also works with HTTPS URLs.

```ts
const response = await fetch("https://example.com");
```

You can also pass `fetch` a [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request) object.

```ts
const request = new Request("http://example.com", {
  method: "POST",
  body: "Hello, world!",
});

const response = await fetch(request);
```

### Sending a POST request

To send a POST request, pass an object with the `method` property set to `"POST"`.

```ts
const response = await fetch("http://example.com", {
  method: "POST",
  body: "Hello, world!",
});
```

`body` can be a string, a `FormData` object, an `ArrayBuffer`, a `Blob`, and more. See the [MDN documentation](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#setting_a_body) for more information.

### Proxying requests

To proxy a request, pass an object with the `proxy` property set to a URL.

```ts
const response = await fetch("http://example.com", {
  proxy: "http://proxy.com",
});
```

### Custom headers

To set custom headers, pass an object with the `headers` property set to an object.

```ts
const response = await fetch("http://example.com", {
  headers: {
    "X-Custom-Header": "value",
  },
});
```

You can also set headers using the [Headers](https://developer.mozilla.org/en-US/docs/Web/API/Headers) object.

```ts
const headers = new Headers();
headers.append("X-Custom-Header", "value");

const response = await fetch("http://example.com", {
  headers,
});
```

### Response bodies

To read the response body, use one of the following methods:

- `response.text(): Promise<string>`: Returns a promise that resolves with the response body as a string.
- `response.json(): Promise<any>`: Returns a promise that resolves with the response body as a JSON object.
- `response.formData(): Promise<FormData>`: Returns a promise that resolves with the response body as a `FormData` object.
- `response.bytes(): Promise<Uint8Array>`: Returns a promise that resolves with the response body as a `Uint8Array`.
- `response.arrayBuffer(): Promise<ArrayBuffer>`: Returns a promise that resolves with the response body as an `ArrayBuffer`.
- `response.blob(): Promise<Blob>`: Returns a promise that resolves with the response body as a `Blob`.

#### Streaming response bodies

You can use async iterators to stream the response body.

```ts
const response = await fetch("http://example.com");

for await (const chunk of response.body) {
  console.log(chunk);
}
```

You can also more directly access the `ReadableStream` object.

```ts
const response = await fetch("http://example.com");

const stream = response.body;

const reader = stream.getReader();
const { value, done } = await reader.read();
```

### Fetching a URL with a timeout

To fetch a URL with a timeout, use `AbortSignal.timeout`:

```ts
const response = await fetch("http://example.com", {
  signal: AbortSignal.timeout(1000),
});
```

#### Canceling a request

To cancel a request, use an `AbortController`:

```ts
const controller = new AbortController();

const response = await fetch("http://example.com", {
  signal: controller.signal,
});

controller.abort();
```

### Unix domain sockets

To fetch a URL using a Unix domain socket, use the `unix: string` option:

```ts
const response = await fetch("https://hostname/a/path", {
  unix: "/var/run/path/to/unix.sock",
  method: "POST",
  body: JSON.stringify({ message: "Hello from Bun!" }),
  headers: {
    "Content-Type": "application/json",
  },
});
```

### TLS

To use a client certificate, use the `tls` option:

```ts
await fetch("https://example.com", {
  tls: {
    key: Bun.file("/path/to/key.pem"),
    cert: Bun.file("/path/to/cert.pem"),
    // ca: [Bun.file("/path/to/ca.pem")],
  },
});
```

#### Custom TLS Validation

To customize the TLS validation, use the `checkServerIdentity` option in `tls`

```ts
await fetch("https://example.com", {
  tls: {
    checkServerIdentity: (hostname, peerCertificate) => {
      // Return an error if the certificate is invalid
    },
  },
});
```

This is similar to how it works in Node's `net` module.

## Debugging

To help with debugging, you can pass `verbose: true` to `fetch`:

```ts
const response = await fetch("http://example.com", {
  verbose: true,
});
```

This will print the request and response headers to your terminal:

```sh
[fetch] > HTTP/1.1 GET http://example.com/
[fetch] > Connection: keep-alive
[fetch] > User-Agent: Bun/1.1.21
[fetch] > Accept: */*
[fetch] > Host: example.com
[fetch] > Accept-Encoding: gzip, deflate, br

[fetch] < 200 OK
[fetch] < Content-Encoding: gzip
[fetch] < Age: 201555
[fetch] < Cache-Control: max-age=604800
[fetch] < Content-Type: text/html; charset=UTF-8
[fetch] < Date: Sun, 21 Jul 2024 02:41:14 GMT
[fetch] < Etag: "3147526947+gzip"
[fetch] < Expires: Sun, 28 Jul 2024 02:41:14 GMT
[fetch] < Last-Modified: Thu, 17 Oct 2019 07:18:26 GMT
[fetch] < Server: ECAcc (sac/254F)
[fetch] < Vary: Accept-Encoding
[fetch] < X-Cache: HIT
[fetch] < Content-Length: 648
```

Note: `verbose: boolean` is not part of the Web standard `fetch` API and is specific to Bun.

## Performance

Before an HTTP request can be sent, the DNS lookup must be performed. This can take a significant amount of time, especially if the DNS server is slow or the network connection is poor.

After the DNS lookup, the TCP socket must be connected and the TLS handshake might need to be performed. This can also take a significant amount of time.

After the request completes, consuming the response body can also take a significant amount of time and memory.

At every step of the way, Bun provides APIs to help you optimize the performance of your application.

### DNS prefetching

To prefetch a DNS entry, you can use the `dns.prefetch` API. This API is useful when you know you'll need to connect to a host soon and want to avoid the initial DNS lookup.

```ts
import { dns } from "bun";

dns.prefetch("bun.sh");
```

#### DNS caching

By default, Bun caches and deduplicates DNS queries in-memory for up to 30 seconds. You can see the cache stats by calling `dns.getCacheStats()`:

To learn more about DNS caching in Bun, see the [DNS caching](https://bun.sh/docs/api/dns) documentation.

### Preconnect to a host

To preconnect to a host, you can use the `fetch.preconnect` API. This API is useful when you know you'll need to connect to a host soon and want to start the initial DNS lookup, TCP socket connection, and TLS handshake early.

```ts
import { fetch } from "bun";

fetch.preconnect("https://bun.sh");
```

Note: calling `fetch` immediately after `fetch.preconnect` will not make your request faster. Preconnecting only helps if you know you'll need to connect to a host soon, but you're not ready to make the request yet.

#### Preconnect at startup

To preconnect to a host at startup, you can pass `--fetch-preconnect`:

```sh
$ bun --fetch-preconnect https://bun.sh ./my-script.ts
```

This is sort of like `<link rel="preconnect">` in HTML.

This feature is not implemented on Windows yet. If you're interested in using this feature on Windows, please file an issue and we can implement support for it on Windows.

### Connection pooling & HTTP keep-alive

Bun automatically reuses connections to the same host. This is known as connection pooling. This can significantly reduce the time it takes to establish a connection. You don't need to do anything to enable this; it's automatic.

#### Simultaneous connection limit

By default, Bun limits the maximum number of simultaneous `fetch` requests to 256. We do this for several reasons:

- It improves overall system stability. Operating systems have an upper limit on the number of simultaneous open TCP sockets, usually in the low thousands. Nearing this limit causes your entire computer to behave strangely. Applications hang and crash.
- It encourages HTTP Keep-Alive connection reuse. For short-lived HTTP requests, the slowest step is often the initial connection setup. Reusing connections can save a lot of time.

When the limit is exceeded, the requests are queued and sent as soon as the next request ends.

You can increase the maximum number of simultaneous connections via the `BUN_CONFIG_MAX_HTTP_REQUESTS` environment variable:

```sh
$ BUN_CONFIG_MAX_HTTP_REQUESTS=512 bun ./my-script.ts
```

The max value for this limit is currently set to 65,336. The maximum port number is 65,535, so it's quite difficult for any one computer to exceed this limit.

### Response buffering

Bun goes to great lengths to optimize the performance of reading the response body. The fastest way to read the response body is to use one of these methods:

- `response.text(): Promise<string>`
- `response.json(): Promise<any>`
- `response.formData(): Promise<FormData>`
- `response.bytes(): Promise<Uint8Array>`
- `response.arrayBuffer(): Promise<ArrayBuffer>`
- `response.blob(): Promise<Blob>`

You can also use `Bun.write` to write the response body to a file on disk:

```ts
import { write } from "bun";

await write("output.txt", response);
```
