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
    if (server.upgrade(req)) {
      // When upgrading, we return undefined since we don't want to send a Response
      return;
    }

    return new Response("Regular HTTP response");
  },
});

Bun.serve<{
  name: string;
}>({
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
      ) {
        return;
      }
    }

    return new Response("Expected a websocket connection", { status: 400 });
  },

  websocket: {
    open(ws) {
      console.log("WebSocket opened");
      ws.subscribe("the-group-chat");
    },

    message(ws, message) {
      ws.publish("the-group-chat", `${ws.data.name}: ${message.toString()}`);
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

Bun.serve({
  fetch(req) {
    throw new Error("woops!");
  },
  error(error) {
    return new Response(`<pre>${error.message}\n${error.stack}</pre>`, {
      headers: {
        "Content-Type": "text/html",
      },
    });
  },
});

export {};

Bun.serve({
  port: 1234,
  fetch(req, server) {
    server.upgrade(req);
    if (Math.random() > 0.5) return undefined;
    return new Response();
  },
  websocket: { message() {} },
});

Bun.serve({
  unix: "/tmp/bun.sock",
  fetch() {
    return new Response();
  },
});

Bun.serve({
  unix: "/tmp/bun.sock",
  fetch(req, server) {
    server.upgrade(req);
    if (Math.random() > 0.5) return undefined;
    return new Response();
  },
  websocket: { message() {} },
});

Bun.serve({
  unix: "/tmp/bun.sock",
  fetch() {
    return new Response();
  },
  tls: {},
});

Bun.serve({
  unix: "/tmp/bun.sock",
  fetch(req, server) {
    server.upgrade(req);
    if (Math.random() > 0.5) return undefined;
    return new Response();
  },
  websocket: { message() {} },
  tls: {},
});

Bun.serve({
  fetch(req, server) {
    server.upgrade(req);
  },
  websocket: {
    open(ws) {
      console.log("WebSocket opened");
      ws.subscribe("test-channel");
    },

    message(ws, message) {
      ws.publish("test-channel", `${message.toString()}`);
    },
    perMessageDeflate: true,
  },
});
// Bun.serve({
//   unix: "/tmp/bun.sock",
//   // @ts-expect-error
//   port: 1234,
//   fetch() {
//     return new Response();
//   },
// });

// Bun.serve({
//   unix: "/tmp/bun.sock",
//   // @ts-expect-error
//   port: 1234,
//   fetch(req, server) {
//     server.upgrade(req);
//     if (Math.random() > 0.5) return undefined;
//     return new Response();
//   },
//   websocket: { message() {} },
// });
