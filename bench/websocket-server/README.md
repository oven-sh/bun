# websocket-server

This benchmarks a websocket server intended as a simple but very active chat room.

First, start the server. By default, it will wait for 32 clients which the client script will handle.

Run in Bun (`Bun.serve`):

```bash
bun ./chat-server.bun.js
```

Run in Node (`"ws"` package):

```bash
node ./chat-server.node.mjs
```

Run in Deno (`Deno.serve`):

```bash
deno run -A ./chat-server.deno.mjs
```

Then, run the client script. By default, it will connect 32 clients. This client script can run in Bun, Node, or Deno

```bash
node ./chat-client.mjs
```

The client script loops through a list of messages for each connected client and sends a message.

For example, when the client sends `"foo"`, the server sends back `"John: foo"` so that all members of the chatroom receive the message.

The client script waits until it receives all the messages for each client before sending the next batch of messages.

A single client process can become the bottleneck for fast servers. To spread the 32 clients across several processes, start
each one with `CLIENTS_COUNT` set to its share and `TOTAL_CLIENTS` set to the total the server was started with, so every
process expects the echoes of all senders:

```bash
CLIENTS_COUNT=32 bun ./chat-server.bun.js &
for i in 1 2 3 4; do CLIENTS_COUNT=8 TOTAL_CLIENTS=32 bun ./chat-client.mjs & done; wait
```

This project was created using `bun init` in bun v0.2.1. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
