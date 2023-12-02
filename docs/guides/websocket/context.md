---
name: Set per-socket contextual data on a WebSocket
---

When building a WebSocket server, it's typically necessary to store some identifying information or context associated with each connected client.

With [Bun.serve()](/docs/api/websockets#contextual-data), this "contextual data" is set when the connection is initially upgraded by passing a `data` parameter in the `server.upgrade()` call.

```ts
Bun.serve<{ socketId: number }>({
  fetch(req, server) {
    const success = server.upgrade(req, {
      data: {
        socketId: Math.random(),
      },
    });
    if (success) return undefined;

    // handle HTTP request normally
    // ...
  },
  websocket: {
    // define websocket handlers
    async message(ws, message) {
      // the contextual dta is available as the `data` property
      // on the WebSocket instance
      console.log(`Received ${message} from ${ws.data.socketId}}`);
    },
  },
});
```

---

It's common to read cookies/headers from the incoming request to identify the connecting client.

```ts
type WebSocketData = {
  createdAt: number;
  token: string;
  userId: string;
};

// TypeScript: specify the type of `data`
Bun.serve<WebSocketData>({
  async fetch(req, server) {
    // use a library to parse cookies
    const cookies = parseCookies(req.headers.get("Cookie"));
    const token = cookies["X-Token"];
    const user = await getUserFromToken(token);

    const upgraded = server.upgrade(req, {
      data: {
        createdAt: Date.now(),
        token: cookies["X-Token"],
        userId: user.id,
      },
    });

    if (upgraded) return undefined;
  },
  websocket: {
    async message(ws, message) {
      // save the message to a database
      await saveMessageToDatabase({
        message: String(message),
        userId: ws.data.userId,
      });
    },
  },
});
```
