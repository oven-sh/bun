// One row of the write-callback contract table per process.
// usage: <rt> rows.mjs <stream> <state> <seq>     env REPORT=<file>
//   stream: stdout | stderr | tty | child.stdin | worker.stdout | net.client | net.server | fs.createWriteStream | PassThrough
//   state : idle | parked | failing
//   seq   : see SEQ below
// The driver controls the reader of stdout/stderr (it starts reading, or closes, after "ready").
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { Writable, PassThrough } from "node:stream";
import tty from "node:tty";
import wt from "node:worker_threads";

const BIG = (1 << 20) + 1;
const protoWrite = (w, c, cb) => Writable.prototype.write.call(w, c, cb);
export const SEQ = {
  "write x3": { cbs: ["w0", "w1", "w2"], run: (w, r, first) => { w.write(first, r("w0")); w.write("", r("w1")); w.write("b", r("w2")); } },
  "proto.write x3": { cbs: ["w0", "w1", "w2"], run: (w, r, first) => { protoWrite(w, first, r("w0")); protoWrite(w, "", r("w1")); protoWrite(w, "b", r("w2")); } },
  "write,proto.write,write": { cbs: ["w0", "w1", "w2"], run: (w, r, first) => { w.write(first, r("w0")); protoWrite(w, "b", r("w1")); w.write("c", r("w2")); } },
  "proto.write,write": { cbs: ["w0", "w1"], run: (w, r, first) => { protoWrite(w, first, r("w0")); w.write("b", r("w1")); } },
  "write,end(chunk,cb)": { cbs: ["w0", "end"], run: (w, r, first) => { w.write(first, r("w0")); w.end("b", r("end")); } },
  "write,write,end(cb)": { cbs: ["w0", "w1", "end"], run: (w, r, first) => { w.write(first, r("w0")); w.write("b", r("w1")); w.end(r("end")); } },
  "write,write('',cb),end(cb)": { cbs: ["w0", "w1", "end"], run: (w, r, first) => { w.write(first, r("w0")); w.write("", r("w1")); w.end(r("end")); } },
  "write,write,destroy()": { cbs: ["w0", "w1"], run: (w, r, first) => { w.write(first, r("w0")); w.write("b", r("w1")); w.destroy(); } },
  "write,write,end(cb),destroy()": { cbs: ["w0", "w1", "end"], run: (w, r, first) => { w.write(first, r("w0")); w.write("b", r("w1")); w.end(r("end")); w.destroy(); } },
};

async function main() {
  const [stream, state, seq] = process.argv.slice(2);
  const report = process.env.REPORT;
  const ev = [];
  let inside = true;
  let left = SEQ[seq].cbs.length;
  let finish;
  const finished = new Promise(r => (finish = r));
  const rec = name => err => {
    ev.push((inside ? "INSIDE:" : "") + name + (err ? ":" + (err.code ?? err.message) : ""));
    if (--left === 0) finish();
  };

  let w, after = () => {}, cleanup = () => {};
  if (stream === "stdout" || stream === "stderr") {
    w = process[stream];
    after = () => fs.writeSync(stream === "stdout" ? 2 : 1, "ready\n");
  } else if (stream === "tty") {
    w = new tty.WriteStream(1);
  } else if (stream === "child.stdin") {
    const S = process.env.KID_SLEEP ?? "0.3"; const script = state === "failing" ? `sleep ${S}; exec 0<&-; sleep 5` : state === "parked" ? `sleep ${S}; exec cat > /dev/null` : "exec cat > /dev/null";
    const kid = spawn("sh", ["-c", script], { stdio: ["pipe", "ignore", "ignore"] });
    w = kid.stdin;
    cleanup = () => kid.kill("SIGKILL");
  } else if (stream === "net.client" || stream === "net.server") {
    let peer;
    const server = net.createServer(s => { peer = s; if (stream === "net.client") { if (state === "idle") s.resume(); s.on("error", () => {}); } });
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    const client = net.connect(server.address().port, "127.0.0.1");
    await new Promise(r => client.on("connect", r));
    while (!peer) await new Promise(r => setTimeout(r, 5));
    const other = stream === "net.client" ? peer : client;
    w = stream === "net.client" ? client : peer;
    other.on("error", () => {});
    if (state === "idle") other.resume();
    if (state === "parked") setTimeout(() => other.resume(), 300);
    if (state === "failing") setTimeout(() => other.destroy(), 300);
    cleanup = () => { server.close(); client.destroy(); peer.destroy(); };
  } else if (stream === "fs.createWriteStream") {
    w = fs.createWriteStream(path.join(os.tmpdir(), "row-" + process.pid + ".txt"));
  } else if (stream === "PassThrough") {
    w = new PassThrough(); w.resume();
  } else if (stream === "worker.stdout") {
    // The stream lives in a worker thread (web Worker where the runtime has one), the reader is the driver.
    if (wt.isMainThread && !globalThis.__isWebWorker) {
      const data = await new Promise(resolve => {
        if (typeof globalThis.Worker === "function" && process.versions.bun) {
          const wk = new Worker(import.meta.url, { argv: process.argv.slice(2), env: { ...process.env, ROW_WORKER: "1" } });
          wk.onmessage = e => resolve(e.data);
          wk.onerror = e => resolve({ ev: ["worker error: " + e.message] });
        } else {
          const wk = new wt.Worker(new URL(import.meta.url), { argv: process.argv.slice(2), env: { ...process.env, ROW_WORKER: "1" } });
          wk.on("message", resolve);
          wk.on("error", e => resolve({ ev: ["worker error: " + e.message] }));
        }
      });
      fs.writeFileSync(report, JSON.stringify(data));
      process.exit(0);
    }
    w = process.stdout;
    after = () => fs.writeSync(2, "ready\n");
  } else {
    throw new Error("unknown stream " + stream);
  }

  for (const e of ["finish", "error", "close"]) w.on(e, x => ev.push(e + (x && (x.code ?? x.message) ? ":" + (x.code ?? x.message) : "")));
  const first = state === "idle" ? "a" : Buffer.alloc(BIG, 97);
  const ret = [];
  try {
    SEQ[seq].run(w, rec, first);
  } catch (e) {
    ev.push("threw:" + (e.code ?? e.message));
  }
  inside = false;
  ev.push("|");
  after();

  await Promise.race([finished, new Promise(r => setTimeout(r, 4000))]);
  await new Promise(r => setTimeout(r, 200));
  const data = { ev, left, ctor: w.constructor?.name, fast: Object.getOwnPropertySymbols(w).filter(s => /FastPath/.test(String(s))).length > 0 };
  try { cleanup(); } catch {}
  if (process.env.ROW_WORKER) {
    (wt.parentPort ?? globalThis).postMessage(data);
    return;
  }
  fs.writeFileSync(report, JSON.stringify(data));
  process.exit(0);
}
if (process.argv[2] && process.argv[2] !== "--import-only") await main();
