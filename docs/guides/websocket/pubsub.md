---
name: Build a publish-subscribe WebSocket server
---

Bun's server-side `WebSocket` API provides a native pub-sub API. Sockets can be subscribed to a set of named channels using `socket.subscribe(<name>)`; messages can be published to a channel using `socket.publish(<name>, <message>)`.

This code snippet implements a simple single-channel chat server.

```ts
const server = Bun.serve<{ username: string }>({
  fetch(req, server) {
    const cookies = req.headers.get("cookie");
    const username = getUsernameFromCookies(cookies);
    const success = server.upgrade(req, { data: { username } });
    if (success) return undefined;

    return new Response("Hello world");
  },
  websocket: {
    open(ws) {
      const msg = `${ws.data.username} has entered the chat`;
      ws.subscribe("the-group-chat");
      ws.publish("the-group-chat", msg);
    },
    message(ws, message) {
      // the server re-broadcasts incoming messages to everyone
      ws.publish("the-group-chat", `${ws.data.username}: ${message}`);
    },
    close(ws) {
      const msg = `${ws.data.username} has left the chat`;
      server.publish("the-group-chat", msg);
      ws.unsubscribe("the-group-chat");
    },
  },
});

console.log(`Listening on ${server.hostname}:${server.port}`);
```
