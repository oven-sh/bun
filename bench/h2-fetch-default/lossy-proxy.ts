// Userspace lossy TCP proxy. Approximates `netem delay 30ms loss 1%` when
// CAP_NET_ADMIN is unavailable: each forwarded chunk incurs `--delay` ms, and
// with probability `--loss` an additional `--rto` ms (simulating a dropped
// segment + retransmit). Per-connection independent, so N parallel h1 sockets
// each roll their own dice while one h2 socket shares one fate — the TCP HOL
// effect the brief wants to probe.
//
// Caveat: byte-stream level, not packet level. Captures HOL stalls; does NOT
// model per-connection cwnd. Good enough for the "does h2 lose under loss"
// gate; the real dnctl/pfctl run is the authority.
//
// Usage: bun lossy-proxy.ts --upstream <port> [--delay 30] [--loss 0.01] [--rto 200] [--seed N]
// Prints "PROXY <port>" once listening.

import net from "node:net";

const args = process.argv.slice(2);
function flag(name: string, def?: string) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
}
const UPSTREAM = Number(flag("--upstream"));
const DELAY = Number(flag("--delay", "30"));
const LOSS = Number(flag("--loss", "0.01"));
const RTO = Number(flag("--rto", "200"));
let seed = Number(flag("--seed", "42"));

if (!UPSTREAM) {
  console.error("missing --upstream");
  process.exit(1);
}

// Deterministic PRNG so runs are comparable.
function rand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

function pipe(src: net.Socket, dst: net.Socket) {
  // Serialize writes per-connection to preserve byte order across delayed chunks.
  let tail: Promise<void> = Promise.resolve();
  src.on("data", chunk => {
    const wait = DELAY + (rand() < LOSS ? RTO : 0);
    tail = tail.then(
      () =>
        new Promise<void>(resolve => {
          setTimeout(() => {
            if (!dst.destroyed) dst.write(chunk);
            resolve();
          }, wait);
        }),
    );
  });
  src.on("end", () => {
    tail.then(() => dst.end());
  });
  src.on("error", () => dst.destroy());
}

const server = net.createServer({ pauseOnConnect: true }, client => {
  const upstream = net.connect(UPSTREAM, "127.0.0.1");
  upstream.once("connect", () => {
    pipe(client, upstream);
    pipe(upstream, client);
    client.resume();
  });
  upstream.on("error", () => client.destroy());
  client.on("error", () => upstream.destroy());
  client.on("close", () => upstream.destroy());
  upstream.on("close", () => client.destroy());
});

server.listen(0, () => {
  const { port } = server.address() as net.AddressInfo;
  console.log(`PROXY ${port}`);
  console.error(`[lossy-proxy] ${port} -> ${UPSTREAM} delay=${DELAY}ms loss=${LOSS} rto=${RTO}ms`);
});
