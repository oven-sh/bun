---
name: Upgrade an HTTP request to a WebSocket connection
---

Inside `fetch`, use the `server.upgrade()` function to upgrade an incoming `Request` to a WebSocket connection. Bun automatically returns a 101 Switching Protocols response if the upgrade succeeds.

Refer to the [WebSocket docs](/docs/api/websockets) for more information on building WebSocket servers.

```ts
const server = Bun.serve<{ authToken: string }>({
  fetch(req, server) {
    const success = server.upgrade(req);
    if (success) {
      // Bun automatically returns a 101 Switching Protocols
      // if the upgrade succeeds
      return undefined;
    }

    // handle HTTP request normally
    return new Response("Hello world!");
  },
  websocket: {
    // define websocket handlers
  },
});

console.log(`Listening on localhost:\${server.port}`);
```
