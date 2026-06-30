// tcp-loopback-eventing.mjs
//
// CLAIM (deliberately modest): replacing libuv's uv_poll/AFD socket eventing with
// Bun's native IOCP loop (plan Phase 1) removes the uv_poll_t state machine, the
// bun-usockets poll translation layer, and the two-loop bookkeeping per readiness
// event — but KEEPS the same kernel mechanism (IOCTL_AFD_POLL re-arm per event,
// LIBUV_WINDOWS_REMOVAL_PLAN.md Phase 1 "AFD socket poll (wepoll-style
// IOCTL_AFD_POLL)"). Expected change is small (single-digit %). This script is the
// regression-guard baseline: run it before and after Phase 1; the delta is the
// honest eventing-layer cost, and a regression here is a Phase 1 bug.
//
// MECHANISM (what is and is not removable):
//   - Today every Bun TCP socket on Windows is a uv_poll_t
//     (packages/bun-usockets/src/eventing/libuv.c:93-126 us_poll_start/change ->
//     uv_poll_start), each readiness re-arm is an IOCTL_AFD_POLL on a cached peer
//     socket (libuv src/win/poll.c:127, peer sockets cached per loop at :255-258).
//   - Outbound connects: uSockets does its own non-blocking connect() in bsd.c and
//     arms uv_poll WRITABLE — connect is NOT uv_tcp_connect, and hostname resolution
//     for Bun.connect/fetch is Bun__addrinfo_get on the WorkPool, not uv
//     (packages/bun-usockets/src/context.c:583-628, src/runtime/dns_jsc/dns.rs:3092).
//     This benchmark uses 127.0.0.1 so NO DNS is involved on any path (node:net
//     skips dns.lookup for numeric IPs, src/js/node/net.ts:2463).
//   - The native plan keeps AFD polling, so per-event kernel cost stays; what goes
//     away: uv_poll dispatch, uv_run req/endgame queues, timer::All uv_timer/uv_idle
//     wake hacks, active_handles pokes, and the ignored-timeout double-wake
//     (src/uws_sys/Loop.rs:469-472).
//
// MEASURES (all loopback, hermetic, in-process echo server):
//   1. ping-pong round-trips/s, 1 connection   (per-event latency, loop overhead)
//   2. ping-pong round-trips/s, 64 connections (event batching under fan-in)
//   3. connect+close churn /s, serial and 16-way (uv_poll_init_socket + AFD arm cost)
//
// RUN:
//   bun bench/libuv-removal/tcp-loopback-eventing.mjs
//   node bench/libuv-removal/tcp-loopback-eventing.mjs
// node is a reference point only — its Windows TCP uses overlapped uv_tcp WSARecv,
// a different kernel mechanism than Bun's AFD poll, so bun-vs-node here compares
// mechanisms, not the libuv layer. The before/after comparison that matters is the
// same bun script across the Phase 1 migration.

import net from "node:net";

const WINDOW_MS = 600;
const REPS = 5;

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

const server = net.createServer((s) => {
  s.setNoDelay(true);
  s.on("error", () => {}); // churn phase closes with RST; ignore resets
  s.on("data", (d) => s.write(d));
});
await new Promise((r) => server.listen({ port: 0, host: "127.0.0.1", backlog: 512 }, r));
const PORT = server.address().port;

function connectOnce() {
  return new Promise((res, rej) => {
    const s = net.connect({ port: PORT, host: "127.0.0.1", family: 4 }, () => {
      s.setNoDelay(true);
      res(s);
    });
    s.on("error", rej);
  });
}

// burst connects can overflow the accept queue while the shared loop is busy;
// retry transient refusals instead of failing the run
async function connectSocket() {
  for (let attempt = 0; ; attempt++) {
    try {
      return await connectOnce();
    } catch (e) {
      const transient =
        e.code === "ECONNREFUSED" || e.code === "ECONNRESET" || e.code === "EADDRINUSE";
      if (attempt >= 5 || !transient) throw e;
      await new Promise((r) => setTimeout(r, 5 * (attempt + 1)));
    }
  }
}

// ── ping-pong: C connections, count round trips in a wall-clock window ──
async function pingpong(conns) {
  const sockets = await Promise.all(Array.from({ length: conns }, connectSocket));
  const byte = Buffer.from([1]);
  let rt = 0;
  let running = false;
  for (const s of sockets) {
    s.on("data", () => {
      if (running) {
        rt++;
        s.write(byte);
      }
    });
  }
  // warmup: half a window
  running = true;
  for (const s of sockets) s.write(byte);
  await new Promise((r) => setTimeout(r, WINDOW_MS / 2));

  const reps = [];
  for (let i = 0; i < REPS; i++) {
    rt = 0;
    const t0 = process.hrtime.bigint();
    await new Promise((r) => setTimeout(r, WINDOW_MS));
    const secs = Number(process.hrtime.bigint() - t0) / 1e9;
    reps.push(rt / secs);
  }
  running = false;
  await new Promise((r) => setTimeout(r, 50)); // let in-flight pongs land
  for (const s of sockets) s.destroy();
  return reps;
}

// ── connect churn: K connects+RST-closes, P-way parallel, timed by count ──
// resetAndDestroy() sends RST so neither side accumulates TIME_WAIT state;
// count-bounded so repeated runs can't exhaust the ephemeral port range.
async function churn(parallel, total) {
  let remaining = total;
  async function loop() {
    while (remaining-- > 0) {
      const s = await connectSocket();
      s.on("error", () => {}); // RST teardown may surface as ECONNRESET
      s.resetAndDestroy();
    }
  }
  // warmup
  remaining = 200;
  await Promise.all(Array.from({ length: parallel }, loop)).catch(() => {});
  const reps = [];
  for (let i = 0; i < 3; i++) {
    remaining = total;
    const t0 = process.hrtime.bigint();
    await Promise.all(Array.from({ length: parallel }, loop)).catch(() => {});
    const secs = Number(process.hrtime.bigint() - t0) / 1e9;
    reps.push(total / secs);
  }
  return reps;
}

const rt = typeof Bun !== "undefined" ? `bun ${Bun.version}` : `node ${process.version}`;
console.log(`\nTCP loopback eventing baseline — ${rt} — Windows`);
console.log(`echo server + client in-process on 127.0.0.1 (no DNS on any path)\n`);

for (const conns of [1, 64]) {
  const reps = await pingpong(conns);
  console.log(
    `  ping-pong ${String(conns).padStart(2)} conn${conns > 1 ? "s" : " "}: ` +
      `${Math.round(median(reps)).toLocaleString()} round-trips/s  ` +
      `(min ${Math.round(Math.min(...reps)).toLocaleString()}, max ${Math.round(Math.max(...reps)).toLocaleString()})`,
  );
}
for (const par of [1, 16]) {
  const reps = await churn(par, 1000);
  console.log(
    `  connect churn x${String(par).padEnd(2)}: ` +
      `${Math.round(median(reps)).toLocaleString()} connects/s     ` +
      `(min ${Math.round(Math.min(...reps)).toLocaleString()}, max ${Math.round(Math.max(...reps)).toLocaleString()})`,
  );
}

console.log(
  `\n  Baseline for the Phase 1 loop swap: same kernel AFD mechanism before/after, so` +
    `\n  expect small deltas; treat a regression as a Phase 1 bug, not noise.`,
);
server.close();
