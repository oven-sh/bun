// See ./README.md for instructions on how to run this benchmark.
const port = process.env.PORT || 4001;
const CLIENTS_TO_WAIT_FOR = parseInt(process.env.CLIENTS_COUNT || "", 10) || 16;
var remainingClients = CLIENTS_TO_WAIT_FOR;

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const uWS = require("uWebSockets.js");

var clients = [];
const decoder = new TextDecoder("utf-8");

/* Non-SSL is simply App() */
const app = uWS
  .App()
  .ws("/*", {
    /* There are many common helper features */
    idleTimeout: 32,
    maxPayloadLength: 16 * 1024,
    maxBackpressure: 4 * 1024,
    compression: uWS.DISABLED,
    upgrade: (res, req, context) => {
      const url = req.getUrl();
      const query = req.getQuery();
      const name =
        new URL(new URL(`${url}?${query}`, "http://localhost:3000")).searchParams.get("name") ||
        "Client #" + (CLIENTS_TO_WAIT_FOR - remainingClients);
      /* This immediately calls open handler, you must not use res after this call */
      res.upgrade(
        {
          name /* First argument is UserData (see WebSocket.getUserData()) */,
        },
        /* Spell these correctly */
        req.getHeader("sec-websocket-key"),
        req.getHeader("sec-websocket-protocol"),
        req.getHeader("sec-websocket-extensions"),
        context,
      );
    },
    open: ws => {
      clients.push(ws);
      remainingClients--;
      console.log(`${ws.getUserData().name} connected (${remainingClients} remain)`);

      ws.subscribe("room");

      if (remainingClients === 0) {
        console.log("All clients connected");
        setTimeout(() => {
          console.log('Starting benchmark by sending "ready" message');
          app.publish("room", `ready`);
        }, 100);
      }
    },

    message: (ws, message, isBinary) => {
      const msg = decoder.decode(message);
      const out = `${ws.getUserData().name}: ${msg}`;
      app.publish("room", out, false);
    },
    close: ws => {
      remainingClients++;
    },
  })
  .listen(port, listenSocket => {
    if (listenSocket) {
      console.log(`Waiting for ${remainingClients} clients to connect...\n`, `  http://localhost:${port}/`);
    }
  });
