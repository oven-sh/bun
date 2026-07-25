// One cell of the ABORT × AutoPause matrix.
//
// Usage: <runtime> cell.mjs <shape> <path-id>
// Shapes: fast-cl | slow-trickle | chunked | mid-close
// Path IDs: see PATHS table below (29 entries).
//
// Law under test: after any abort/cancel of a fetch whose body is
// AutoPause-paused, within 2 s the pending op settles AND the origin
// sees the connection close (fd released back).
//
// Emits exactly one JSON line on stdout:
//   {shape, path, rt, settled, settledMs, originClosed, closedMs,
//    backpressured, openConns, fdDelta, err, fault}
//
// Zero-fault contract: exits 0 on law pass, 1 on law fail, 2 on rig error.
// ASAN faults surface as non-zero exit + stderr.

import { createServer } from "node:net";
import { once } from "node:events";
import { readdirSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { Readable } from "node:stream";

const isBun = typeof Bun !== "undefined";
const rt = isBun ? `bun ${Bun.version}+${Bun.revision.slice(0, 9)}` : `node ${process.version}`;

const [, , SHAPE, PATH_ID] = process.argv;
const LAW_MS = 2000;
const CL_BYTES = 32 * 1024 * 1024;
const CHUNK = 64 * 1024;

function fdCount() {
  try { return readdirSync("/proc/self/fd").length; } catch { return -1; }
}

function gc() {
  if (isBun) Bun.gc(true);
  else if (globalThis.gc) globalThis.gc();
}

// ---------------------------------------------------------------------------
// Raw-TCP origin. Observes: backpressure (write() -> false), close, bytes sent.
// ---------------------------------------------------------------------------
const origin = {
  backpressured: false,
  bytesSent: 0,
  openConns: 0,
  closed: false,
  closedAt: 0,
  sockets: new Set(),
};

const bodyChunk = Buffer.alloc(CHUNK, 0x41);

function writeHead(sock, headers) {
  sock.write(`HTTP/1.1 200 OK\r\n${headers}\r\n`);
}

function handleSocket(sock) {
  origin.openConns++;
  origin.sockets.add(sock);
  sock.on("error", () => {});
  sock.on("close", () => {
    origin.openConns--;
    origin.sockets.delete(sock);
    if (!origin.closed) {
      origin.closed = true;
      origin.closedAt = performance.now();
    }
  });
  sock.once("data", () => {
    switch (SHAPE) {
      case "fast-cl": {
        writeHead(sock, `Content-Length: ${CL_BYTES}\r\nConnection: close\r\n`);
        let sent = 0;
        const push = () => {
          while (sent < CL_BYTES && !sock.destroyed) {
            sent += CHUNK;
            origin.bytesSent += CHUNK;
            if (!sock.write(bodyChunk)) {
              origin.backpressured = true;
              return void sock.once("drain", push);
            }
          }
        };
        push();
        break;
      }
      case "slow-trickle": {
        writeHead(sock, `Transfer-Encoding: chunked\r\nConnection: close\r\n`);
        // One 1 KB chunk, then hold the connection open.
        const c = Buffer.alloc(1024, 0x42);
        sock.write(`${c.length.toString(16)}\r\n`);
        sock.write(c);
        sock.write("\r\n");
        origin.bytesSent += c.length;
        // trickle a second chunk after 50 ms so the client's first read
        // returns and the transport re-parks
        setTimeout(() => {
          if (sock.destroyed) return;
          sock.write(`${c.length.toString(16)}\r\n`);
          sock.write(c);
          sock.write("\r\n");
          origin.bytesSent += c.length;
        }, 50);
        break;
      }
      case "chunked": {
        writeHead(sock, `Transfer-Encoding: chunked\r\nConnection: close\r\n`);
        let sent = 0;
        const push = () => {
          while (sent < CL_BYTES && !sock.destroyed) {
            sent += CHUNK;
            origin.bytesSent += CHUNK;
            const ok = sock.write(`${CHUNK.toString(16)}\r\n`) & sock.write(bodyChunk) & sock.write("\r\n");
            if (!ok) {
              origin.backpressured = true;
              return void sock.once("drain", push);
            }
          }
        };
        push();
        break;
      }
      case "mid-close": {
        writeHead(sock, `Content-Length: ${CL_BYTES}\r\nConnection: close\r\n`);
        // send ~256 KB then FIN mid-body
        for (let i = 0; i < 4; i++) {
          origin.bytesSent += CHUNK;
          sock.write(bodyChunk);
        }
        setTimeout(() => sock.end(), 30);
        break;
      }
      default:
        throw new Error(`unknown shape ${SHAPE}`);
    }
  });
}

// ---------------------------------------------------------------------------
// The 29 abort/cancel paths. Each receives (res, ctrl, url) with the body
// already AutoPause-paused (first chunk delivered, transport parked) and
// returns { op } where op is the Promise that must settle within LAW_MS.
// ---------------------------------------------------------------------------

async function firstRead(res) {
  const r = res.body.getReader();
  await r.read();
  return r;
}

const PATHS = {
  // -- AbortController on fetch signal -----------------------------------
  "ac.abort": async (res, ctrl) => {
    ctrl.abort();
    return { op: res.body.cancel().catch(e => e) };
  },
  "ac.abort-reason": async (res, ctrl) => {
    ctrl.abort(new Error("custom"));
    return { op: res.body.cancel().catch(e => e) };
  },
  "ac.abort-read-pending": async (res, ctrl) => {
    const r = res.body.getReader();
    await r.read();
    const pending = r.read(); // parked on AutoPause
    ctrl.abort();
    return { op: pending.catch(e => e) };
  },
  "ac.timeout": async (res) => {
    // signal was AbortSignal.timeout(400). Issue reads until one parks
    // (or errors, for mid-close), then hold it for the timeout.
    const r = res.body.getReader();
    let pending = r.read();
    for (let i = 0; i < 5; i++) {
      let raced;
      try { raced = await Promise.race([pending, sleep(20).then(() => "parked")]); }
      catch { break; }
      if (raced === "parked" || raced?.done) break;
      pending = r.read();
    }
    return { op: pending.then(() => "data", e => e) };
  },
  "ac.any": async (res, ctrl) => {
    // ctrl is the inner controller of AbortSignal.any
    const r = res.body.getReader();
    await r.read();
    const pending = r.read();
    ctrl.abort();
    return { op: pending.catch(e => e) };
  },
  "ac.abort-text": async (res, ctrl) => {
    const p = res.text();
    ctrl.abort();
    return { op: p.catch(e => e) };
  },
  "ac.abort-arraybuffer": async (res, ctrl) => {
    const p = res.arrayBuffer();
    ctrl.abort();
    return { op: p.catch(e => e) };
  },
  "ac.abort-json": async (res, ctrl) => {
    const p = res.json();
    ctrl.abort();
    return { op: p.catch(e => e) };
  },
  "ac.abort-blob": async (res, ctrl) => {
    const p = res.blob();
    ctrl.abort();
    return { op: p.catch(e => e) };
  },
  "ac.abort-bytes": async (res, ctrl) => {
    const p = res.bytes();
    ctrl.abort();
    return { op: p.catch(e => e) };
  },
  "ac.abort-bunwrite": async (res, ctrl) => {
    if (!isBun) return { op: Promise.resolve("skip:node"), skip: true };
    const p = Bun.write("/tmp/abortpause.out", res);
    ctrl.abort();
    return { op: p.catch(e => e) };
  },
  "ac.abort-bunwrite-body": async (res, ctrl) => {
    if (!isBun) return { op: Promise.resolve("skip:node"), skip: true };
    const p = Bun.write("/tmp/abortpause.out", res.body);
    ctrl.abort();
    return { op: p.catch(e => e) };
  },
  "ac.abort-pipeto": async (res, ctrl) => {
    const ws = new WritableStream({ write() {} });
    const p = res.body.pipeTo(ws);
    ctrl.abort();
    return { op: p.catch(e => e) };
  },
  "ac.abort-forawait": async (res, ctrl) => {
    const p = (async () => {
      for await (const _ of res.body) {
        ctrl.abort();
      }
    })();
    return { op: p.catch(e => e) };
  },
  // -- ReadableStream cancel --------------------------------------------
  "rs.body-cancel": async (res) => {
    return { op: res.body.cancel() };
  },
  "rs.reader-cancel": async (res) => {
    const r = await firstRead(res);
    return { op: r.cancel() };
  },
  "rs.reader-cancel-reason": async (res) => {
    const r = await firstRead(res);
    return { op: r.cancel(new Error("nope")) };
  },
  "rs.release-cancel": async (res) => {
    const r = await firstRead(res);
    r.releaseLock();
    return { op: res.body.cancel() };
  },
  "rs.forawait-break": async (res) => {
    const p = (async () => {
      for await (const _ of res.body) break;
    })();
    return { op: p };
  },
  "rs.forawait-throw": async (res) => {
    const p = (async () => {
      for await (const _ of res.body) throw new Error("stop");
    })().catch(e => e);
    return { op: p };
  },
  "rs.pipeto-signal": async (res) => {
    const ac = new AbortController();
    const ws = new WritableStream({ write() {} });
    const p = res.body.pipeTo(ws, { signal: ac.signal }).catch(e => e);
    await sleep(10);
    ac.abort();
    return { op: p };
  },
  "rs.pipeto-sink-error": async (res) => {
    let n = 0;
    const ws = new WritableStream({
      write() { if (n++ > 0) throw new Error("sink"); },
    });
    return { op: res.body.pipeTo(ws).catch(e => e) };
  },
  "rs.pipethrough-cancel": async (res) => {
    const t = new TransformStream();
    const out = res.body.pipeThrough(t);
    const r = out.getReader();
    await r.read();
    return { op: r.cancel() };
  },
  "rs.tee-cancel-both": async (res) => {
    const [a, b] = res.body.tee();
    const ra = a.getReader();
    const rb = b.getReader();
    await ra.read();
    await rb.read();
    return { op: Promise.all([ra.cancel(), rb.cancel()]) };
  },
  // -- GC / drop (caller drops `res` and pumps GC after this returns) ----
  "gc.drop-response": async () => {
    return { op: Promise.resolve(), gcDrop: true };
  },
  "gc.drop-reader": async (res) => {
    let r = res.body.getReader();
    await r.read();
    r = null;
    return { op: Promise.resolve(), gcDrop: true };
  },
  "gc.drop-body": async (res) => {
    res.body; // materialize the ReadableStream wrapper
    return { op: Promise.resolve(), gcDrop: true };
  },
  // -- Node stream wrappers ---------------------------------------------
  "ns.destroy": async (res) => {
    const s = Readable.fromWeb(res.body);
    await once(s, "readable").catch(() => {});
    s.read();
    s.destroy();
    return { op: once(s, "close").then(() => {}) };
  },
  "ns.destroy-err": async (res) => {
    const s = Readable.fromWeb(res.body);
    await once(s, "readable").catch(() => {});
    s.read();
    s.destroy(new Error("boom"));
    return { op: once(s, "close").then(() => {}).catch(() => {}) };
  },
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
const pathFn = PATHS[PATH_ID];
if (!SHAPE || !pathFn) {
  if (PATH_ID === "--list") {
    console.log(JSON.stringify(Object.keys(PATHS)));
    process.exit(0);
  }
  console.error(`usage: cell.mjs <shape> <path-id>`);
  process.exit(2);
}

const srv = createServer(handleSocket);
srv.listen(0, "127.0.0.1");
await once(srv, "listening");
const url = `http://127.0.0.1:${srv.address().port}/`;

const fdBefore = fdCount();
let result = {
  shape: SHAPE, path: PATH_ID, rt,
  settled: false, settledMs: -1,
  originClosed: false, closedMs: -1,
  backpressured: false, openConns: -1, fdDelta: 0,
  err: null, skip: false,
};

try {
  // Build the signal for this path.
  let ctrl = new AbortController();
  let signal = ctrl.signal;
  if (PATH_ID === "ac.timeout") {
    const slack = isBun && Bun.revision && process.execPath.includes("debug") ? 900 : 400;
    signal = AbortSignal.timeout(slack);
  } else if (PATH_ID === "ac.any") {
    const other = new AbortController();
    signal = AbortSignal.any([ctrl.signal, other.signal]);
  }

  let res = await fetch(url, { signal });

  // Let the first body chunk land so AutoPause flips to Paused.
  // For shapes that push fast, backpressure is already hit; for trickle
  // we need the first chunk to arrive.
  await sleep(30);

  const t0 = performance.now();
  const { op, skip, gcDrop } = await pathFn(res, ctrl, url);
  if (skip) { result.skip = true; result.settled = true; }

  // For GC paths, drop refs and pump GC.
  if (gcDrop) {
    res = null; ctrl = null; signal = null;
    for (let i = 0; i < 10; i++) { gc(); await sleep(20); }
  }

  // Law: op settles within LAW_MS.
  const settled = await Promise.race([
    op.then(() => true, () => true),
    sleep(LAW_MS).then(() => false),
  ]);
  result.settled = settled || result.settled;
  result.settledMs = Math.round(performance.now() - t0);

  // Law: origin sees close within LAW_MS (poll; origin.closed flips on 'close').
  const deadline = t0 + LAW_MS;
  while (!origin.closed && performance.now() < deadline) await sleep(10);
  result.originClosed = origin.closed;
  result.closedMs = origin.closed ? Math.round(origin.closedAt - t0) : -1;
  result.backpressured = origin.backpressured;
  result.openConns = origin.openConns;

  // fd delta after a final GC sweep.
  gc(); await sleep(20); gc();
  result.fdDelta = fdCount() - fdBefore;
} catch (e) {
  result.err = String(e?.message ?? e);
}

// Tear down origin without waiting on keep-alive.
for (const s of origin.sockets) s.destroy();
srv.close();

console.log(JSON.stringify(result));
const pass = result.skip || (result.settled && result.originClosed);
process.exit(pass ? 0 : 1);
