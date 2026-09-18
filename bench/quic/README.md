# node:quic (HTTP/3)

Compares bun's `node:quic` against node's. Bun implements the API on lsquic,
node on ngtcp2 + nghttp3; the JS surface is the same, so `server.mjs` and
`client.mjs` run unmodified on either runtime and only the runtime executing
them changes.

Two benchmarks, because either side can be the bottleneck:

- **server bench** — one client runtime drives both servers
- **client bench** — one server runtime answers both clients

Each request is an HTTP/3 GET answered with `:status: 200` and a `BODY_SIZE`
body, with `CONCURRENCY` requests in flight on a single session.

## Running

Node needs to be **built with QUIC** — released builds report
`process.features.quic === false` and `node:quic` throws
`ERR_UNKNOWN_BUILTIN_MODULE`:

```bash
cd /path/to/node
./configure --experimental-quic
make -j$(nproc)
```

Then:

```bash
BUN=path/to/bun NODE=path/to/node/out/Release/node bun run.mjs
```

Knobs (env): `COUNT` (2000), `CONCURRENCY` (50), `BODY_SIZE` (0), `ROUNDS` (3).

Reports the best of `ROUNDS` runs per pairing: QUIC throughput is noisy, and
the fastest round is the one least perturbed by an unrelated scheduler hiccup.

## Notes

- `key.pem`/`cert.pem` are the same self-signed fixtures the node test suite
  uses; the client passes `verifyPeer: "manual"` so the handshake is measured
  rather than the certificate chain.
- The client counts a request as done when its response headers arrive.
- Single session, so this measures stream and packet handling rather than
  handshakes.
