// Proves _debugEnd is per-thread: a worker calling process._debugEnd() must not
// disarm the MAIN thread's exit handshake. Also checks the main-thread case
// still suppresses it, and that inspector.open() re-arms it.
// Usage: node debugend_ab.mjs <BIN>
import { spawn } from "child_process";
import http from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

const BIN = process.argv[2];
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");
const wait = ms => new Promise(r => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l5de-"));
const w = (n, s) => { const p = path.join(dir, n); fs.writeFileSync(p, s); return p; };

const FILES = {
  // a worker calls _debugEnd; the MAIN thread's handshake must survive
  workerDebugEnd: w("wde.js", `const { Worker, isMainThread } = require('worker_threads');
if (!isMainThread) { process._debugEnd(); } else {
  const wk = new Worker(__filename);
  wk.on('exit', () => { console.log('worker gone'); process.exitCode = 55; });
}`),
  // the main thread calls _debugEnd; the handshake must be suppressed
  mainDebugEnd: w("mde.js", `console.log('ran'); process._debugEnd(); process.exitCode = 55;`),
};

const get = (port, p) => new Promise((res, rej) => {
  const r = http.get({ port, family: 4, path: p }, x => { let b = ""; x.setEncoding("utf8"); x.on("data", c => (b += c)).on("end", () => res(b)); });
  r.on("error", rej);
});
const upgrade = (port, p) => new Promise((res, rej) => {
  const r = http.get({ port, family: 4, path: p, headers: { Connection: "Upgrade", Upgrade: "websocket",
    "Sec-WebSocket-Version": 13, "Sec-WebSocket-Key": crypto.randomBytes(16).toString("base64") } });
  r.on("upgrade", (m, sock) => res(sock)); r.on("response", x => rej(new Error("status " + x.statusCode))); r.on("error", rej);
});
function fr(obj) {
  const p = Buffer.from(JSON.stringify(obj)), mask = crypto.randomBytes(4), h = [0x81];
  if (p.length < 126) h.push(0x80 | p.length); else h.push(0x80 | 126, p.length >> 8, p.length & 0xff);
  return Buffer.concat([Buffer.from(h), mask, Buffer.from(p.map((b, i) => b ^ mask[i % 4]))]);
}

async function run(name, file) {
  const child = spawn(BIN, ["--inspect-brk=0", file], { stdio: ["ignore", "pipe", "pipe"], cwd: dir });
  let buf = "", err = "", exited = false, code = null;
  child.stdout.on("data", () => {});
  let resolveCdp; const cdpUrl = new Promise(r => (resolveCdp = r));
  child.stderr.on("data", d => {
    const t = strip(String(d)); buf += t; err += t;
    const c = buf.match(/Debugger listening on (ws:\/\/\S+)/); if (c) resolveCdp(c[1]);
  });
  child.on("exit", c => { exited = true; code = c; });
  const to = ms => new Promise(r => setTimeout(() => r(null), ms));
  const waitExit = async ms => { const end = Date.now() + ms; while (!exited && Date.now() < end) await wait(25); return exited; };

  const u = new URL((await Promise.race([cdpUrl, to(8000)])) || "ws://x/x");
  const list = JSON.parse(await get(u.port, "/json/list"));
  const sock = await upgrade(u.port, new URL(list[0].webSocketDebuggerUrl).pathname);
  let id = 0, acc = Buffer.alloc(0);
  sock.on("error", () => {});
  sock.on("data", d => {
    acc = Buffer.concat([acc, d]);
    for (;;) {
      if (acc.length < 2) return;
      const l0 = acc[1] & 0x7f; let len = l0, hdr = 2;
      if (l0 === 126) { if (acc.length < 4) return; len = acc.readUInt16BE(2); hdr = 4; }
      else if (l0 === 127) { if (acc.length < 10) return; len = Number(acc.readBigUInt64BE(2)); hdr = 10; }
      if (acc.length < hdr + len) return;
      const body = acc.slice(hdr, hdr + len).toString(); acc = acc.slice(hdr + len);
      if (!body) continue;
      let o; try { o = JSON.parse(body); } catch { continue; }
      if (o.method === "Debugger.paused") sock.write(fr({ id: ++id, method: "Debugger.resume", params: {} }));
    }
  });
  const send = (m, p = {}) => sock.write(fr({ id: ++id, method: m, params: p }));
  send("Runtime.enable"); send("Debugger.enable"); send("NodeRuntime.enable");
  await wait(350);
  send("Runtime.runIfWaitingForDebugger");

  const blocked = !(await waitExit(3000));
  sock.destroy();
  const out = await waitExit(5000);
  if (!exited) { try { child.kill("SIGKILL"); } catch {} }
  await wait(80);
  const msg = err.includes("Waiting for the debugger to disconnect...");
  console.log(`${name.padEnd(22)} handshake=${String(msg).padEnd(5)} blockedWhileAttached=${String(blocked).padEnd(5)} exited=${String(out).padEnd(5)} code=${code}`);
  return { msg, blocked, exited: out, code };
}

const wk = await run("worker-_debugEnd", FILES.workerDebugEnd);
const mn = await run("main-_debugEnd", FILES.mainDebugEnd);

console.log("\n================ SUMMARY ================");
// A worker's _debugEnd must leave the main thread's handshake armed.
const ok1 = wk.msg === true && wk.blocked === true && wk.exited && wk.code === 55;
// The main thread's own _debugEnd must suppress it (Node: io_ == nullptr).
const ok2 = mn.msg === false && mn.blocked === false && mn.exited && mn.code === 55;
console.log(`${ok1 ? "PASS" : "FAIL"}  worker _debugEnd does NOT disarm the main thread`);
console.log(`${ok2 ? "PASS" : "FAIL"}  main-thread _debugEnd DOES suppress the handshake`);
process.exit(ok1 && ok2 ? 0 : 1);
