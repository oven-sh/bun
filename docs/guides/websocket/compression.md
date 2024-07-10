---
name: Enable compression for WebSocket messages
---

Per-message compression can be enabled with the `perMessageDeflate` parameter. When set, all messages will be compressed using the [permessage-deflate](https://tools.ietf.org/html/rfc7692) WebSocket extension.

```ts
Bun.serve({
  // ...
  websocket: {
    // enable compression
    perMessageDeflate: true,
  },
});
```

---

To enable compression for individual messages, pass `true` as the second parameter to `ws.send()`.

```ts
Bun.serve({
  // ...
  websocket: {
    async message(ws, message) {
      // send a compressed message
      ws.send(message, true);
    },
  },
});
```
