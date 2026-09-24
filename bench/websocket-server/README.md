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

## HTTP/1.1 versus HTTP/2 WebSocket transport

`protocol-run.mjs` compares the same Bun echo handler over an HTTP/1.1
WebSocket and RFC 8441 Extended CONNECT. It validates every echoed payload.
The runner reports HTTP/2 both with one connection per WebSocket and with
multiple WebSocket streams multiplexed on fewer connections. It also reports
the server's initial, final, and peak RSS and fails if any WebSocket remains
open after the clients exit.

Both protocols use the same bounded raw RFC 6455 frame encoder and decoder in
the Node client. The H1 path performs and validates a raw HTTP/1.1 Upgrade over
`node:net`; the H2 path uses `node:http2` for Extended CONNECT. This keeps a
runtime's built-in WebSocket implementation out of the transport comparison.

Use a release build for server measurements. The client runtime needs
`node:http2` support for Extended CONNECT.

```bash
BUN=../../build/release/bun node ./protocol-run.mjs
```

Compare two binaries with the same client and workload:

```bash
BUN=/path/to/candidate \
BUN_BASELINE=/path/to/baseline \
node ./protocol-run.mjs
```

The default `WORKLOAD=echo` calls `ws.send()` for every message. Set
`WORKLOAD=pubsub-self` to benchmark `ws.publish()` instead: every WebSocket
subscribes to a unique topic and publishes back to itself, keeping one receiver
per message without cross-process topic collisions or fan-out.

Candidate and baseline repetitions run in alternating AB/BA order to reduce
system-temperature and background-load drift. Use an odd `RUNS` value so each
binary has comparable exposure to both positions. The runner reports both
independent medians and the median candidate delta across matched repetitions;
inspect the paired min/max range before treating that delta as stable.

The baseline runs the H1 case by default because a pre-feature binary cannot
accept RFC 8441. Set `BASELINE_SUPPORTS_H2=1` only when both binaries implement
HTTP/2 WebSockets.

The main knobs are `WORKLOAD`, `RUNS`, `CYCLES`, `PROCESSES`, `STREAMS`,
`H2_MUX_SESSIONS`, `PAYLOAD_SIZES`, `WARMUP_MS`, `DURATION_MS`,
`H2_STREAM_WINDOW_SIZE`, and `H2_CONNECTION_WINDOW_SIZE`. `STREAMS` must be
divisible by `PROCESSES`. The default payload matrix is 16 bytes, 1 KiB, and
64 KiB.

The H2 client advertises a 16 MiB initial stream window and expands its local
connection window to 64 MiB by default. This prevents the benchmark from
mistaking Node's default 64 KiB receive windows and their `WINDOW_UPDATE`
roundtrips for Bun server throughput, especially when several large WebSocket
messages share one H2 connection. Set both window variables to `65535` to
measure default-window behavior instead. The selected values are recorded in
every H2 JSON row.

`RUNS` starts a fresh server for independent benchmark repetitions. `CYCLES`
runs repeated connect/measure/disconnect rounds against each one of those server
processes and reports RSS after every cycle in the JSON row. Use multiple cycles
for a retention/cleanup soak; throughput is averaged across the cycles.

The runner measures client-observed round-trip throughput. Run enough client
processes to reach a stable server plateau before interpreting the result as a
server limit. Use CPU profiles and platform RSS measurements to diagnose that
plateau; throughput alone does not identify the bottleneck. RSS is allocator-
and platform-sensitive, so use a longer `DURATION_MS` and compare slopes or
repeated runs rather than treating one small delta as a leak verdict.
