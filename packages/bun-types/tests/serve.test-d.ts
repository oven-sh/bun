Bun.serve({
  fetch(req) {
    console.log(req.url); // => http://localhost:3000/
    return new Response("Hello World");
  },
});

Bun.serve({
  fetch(req) {
    console.log(req.url); // => http://localhost:3000/
    return new Response("Hello World");
  },
  keyFile: "ca.pem",
  certFile: "cert.pem",
});

Bun.serve({
  websocket: {
    message(ws, message) {
      ws.send(message);
    },
  },

  fetch(req, server) {
    // Upgrade to a ServerWebSocket if we can
    // This automatically checks for the `Sec-WebSocket-Key` header
    // meaning you don't have to check headers, you can just call `upgrade()`
    if (server.upgrade(req))
      // When upgrading, we return undefined since we don't want to send a Response
      return;

    return new Response("Regular HTTP response");
  },
});

type User = {
  name: string;
};

Bun.serve<User>({
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/chat") {
      if (
        server.upgrade(req, {
          data: {
            name: new URL(req.url).searchParams.get("name") || "Friend",
          },
          headers: {
            "Set-Cookie": "name=" + new URL(req.url).searchParams.get("name"),
          },
        })
      )
        return;
    }

    return new Response("Expected a websocket connection", { status: 400 });
  },

  websocket: {
    open(ws) {
      console.log("WebSocket opened");
      ws.subscribe("the-group-chat");
    },

    message(ws, message) {
      ws.publish("the-group-chat", `${ws.data.name}: ${message}`);
    },

    close(ws, code, reason) {
      ws.publish("the-group-chat", `${ws.data.name} left the chat`);
    },

    drain(ws) {
      console.log("Please send me data. I am ready to receive it.");
    },

    perMessageDeflate: true,
  },
});

export {};
