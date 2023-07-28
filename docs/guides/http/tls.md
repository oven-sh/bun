---
name: Configure TLS on an HTTP server
---

Set the `tls` key to configure TLS. Both `key` and `cert` are required. The `key` should be the contents of your private key; `cert` should be the contents of your issued certificate. Use [`Bun.file()`](/docs/api/file-io#reading-files-bun-file) to read the contents.

```ts
const server = Bun.serve({
  fetch: (request) => new Response("Welcome to Bun!"),
  tls: {
    cert: Bun.file("cert.pem"),
    key: Bun.file("key.pem"),
  },
});
```

---

By default Bun trusts the default Mozilla-curated list of well-known root CAs. To override this list, pass an array of certificates as `ca`.

```ts
const server = Bun.serve({
  fetch: (request) => new Response("Welcome to Bun!"),
  tls: {
    cert: Bun.file("cert.pem"),
    key: Bun.file("key.pem"),
    ca: [Bun.file("ca1.pem"), Bun.file("ca2.pem")],
  },
});
```
