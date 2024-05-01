---
name: Proxy HTTP requests using fetch()
---

In Bun, `fetch` supports sending requests through an HTTP or HTTPS proxy. This is useful on corporate networks or when you need to ensure a request is sent through a specific IP address.

```ts
await fetch("https://example.com", {
  // The URL of the proxy server
  proxy: "https://username:password@proxy.example.com:8080",
});
```

---

The `proxy` option is a URL string that specifies the proxy server. It can include the username and password if the proxy requires authentication. It can be `http://` or `https://`.

---

You can also set the `$HTTP_PROXY` or `$HTTPS_PROXY` environment variable to the proxy URL. This is useful when you want to use the same proxy for all requests.

```sh
HTTPS_PROXY=https://username:password@proxy.example.com:8080 bun run index.ts
```
