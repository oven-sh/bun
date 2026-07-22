// L5 safety matrix, part 4: the two cross-session hangs.
//
// Row 1 "binary-frame-retires-session":
//   A opts into notifyWhenWaitingForDisconnect, then sends a BINARY WebSocket
//   frame. That lands in Debugger#error, which closes the native connection —
//   so A is filtered out of the handshake set and never gets the signal. If
//   #error does not also retire A's adapter, A keeps its opt-in and B (which
//   never opted in) is told nothing and waits forever.
//
// Row 2 "late-optin-must-not-suppress":
//   A opts in, B does not. The handshake starts (A gets waitingForDisconnect,
//   B correctly gets nothing yet). C then attaches mid-handshake and opts in.
//   If the retaining count is live rather than snapshotted, A leaving no longer
//   drops it to zero, the deferred executionContextDestroyed is skipped, and B
//   waits forever.
//
// Both frontends only leave once the runtime has actually told them the context
// is going away — a real DevTools would not close on its own.
//
// Usage: node matrix_l5d.mjs <BIN>
import { spawn } from "child_process";
import http from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

const BIN = process.argv[2];
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");
const wait = ms => new Promise(r => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l5x-"));
const script = path.join(dir, "nat.js");
fs.writeFileSync(script, `console.log('ran'); process.exitCode = 55;`);

const get = (port, p) => new Promise((res, rej) => {
  const r = http.get({ port, family: 4, path: p }, x => { let b = ""; x.setEncoding("utf8"); x.on("data", c => (b += c)).on("end", () => res(b)); });
  r.on("error", rej);
});
const upgrade = (port, p) => new Promise((res, rej) => {
  const r = http.get({ port, family: 4, path: p, headers: { Connection: "Upgrade", Upgrade: "websocket",
    "Sec-WebSocket-Version": 13, "Sec-WebSocket-Key": crypto.randomBytes(16).toString("base64") } });
  r.on("upgrade", (m, sock) => res(sock)); r.on("response", x => rej(new Error("status " + x.statusCode))); r.on("error", rej);
});
function frame(payload, opcode) {
  const mask = crypto.randomBytes(4), h = [0x80 | opcode];
  if (payload.length < 126) h.push(0x80 | payload.length);
  else h.push(0x80 | 126, payload.length >> 8, payload.length & 0xff);
  return Buffer.concat([Buffer.from(h), mask, Buffer.from(payload.map((b, i) => b ^ mask[i % 4]))]);
}
const txt = obj => frame(Buffer.from(JSON.stringify(obj)), 0x1);
const bin = () => frame(Buffer.from([1, 2, 3, 4]), 0x2);

function session(sock, label, ev, at) {
  let acc = Buffer.alloc(0), id = 0;
  const saw = { waitingForDisconnect: false, contextDestroyed: false };
  const gotSignal = Promise.withResolvers();
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
      if (o.method === "Debugger.scriptParsed") continue;
      if (o.method === "Debugger.paused") { sock.write(txt({ id: ++id, method: "Debugger.resume", params: {} })); continue; }
      if (o.method) ev.push(`${at()} [${label}] ${o.method}`);
      if (o.method === "NodeRuntime.waitingForDisconnect") { saw.waitingForDisconnect = true; gotSignal.resolve(); }
      if (o.method === "Runtime.executionContextDestroyed") { saw.contextDestroyed = true; gotSignal.resolve(); }
    }
  });
  return {
    saw, gotSignal,
    send: (m, p = {}) => sock.write(txt({ id: ++id, method: m, params: p })),
    binary: () => sock.write(bin()),
    close: () => sock.destroy(),
  };
}

async function boot(ev, at) {
  const child = spawn(BIN, ["--inspect-brk=0", script], { stdio: ["ignore", "pipe", "pipe"], cwd: dir });
  let buf = "", err = "", exited = false, code = null;
  child.stdout.on("data", () => {});
  let resolveCdp; const cdpUrl = new Promise(r => (resolveCdp = r));
  child.stderr.on("data", d => {
    const t = strip(String(d)); buf += t; err += t;
    for (const l of t.split("\n")) if (l.trim() && !l.includes("Bun Inspector") && !l.includes("debug.bun.sh") && !l.includes("Listening") && !l.includes("For help")) ev.push(`${at()} STDERR ${l.trim()}`);
    const c = buf.match(/Debugger listening on (ws:\/\/\S+)/); if (c) resolveCdp(c[1]);
  });
  child.on("exit", c => { exited = true; code = c; });
  const to = ms => new Promise(r => setTimeout(() => r(null), ms));
  const u = new URL((await Promise.race([cdpUrl, to(8000)])) || "ws://x/x");
  const list = JSON.parse(await get(u.port, "/json/list"));
  const wsPath = new URL(list[0].webSocketDebuggerUrl).pathname;
  const waitExit = async ms => { const end = Date.now() + ms; while (!exited && Date.now() < end) await wait(25); return exited; };
  const notice = () => err.includes("Waiting for the debugger to disconnect...");
  return {
    child, port: u.port, wsPath, waitExit, notice,
    get exited() { return exited; }, get code() { return code; },
    kill: () => { try { if (!exited) child.kill("SIGKILL"); } catch {} },
  };
}

async function rowBinaryFrame() {
  const ev = []; const t0 = Date.now(); const at = () => `+${String(Date.now() - t0).padStart(5)}ms`;
  const c = await boot(ev, at);
  const A = session(await upgrade(c.port, c.wsPath), "A", ev, at);
  const B = session(await upgrade(c.port, c.wsPath), "B", ev, at);
  A.send("Runtime.enable"); A.send("Debugger.enable"); A.send("NodeRuntime.enable");
  A.send("NodeRuntime.notifyWhenWaitingForDisconnect", { enabled: true });
  B.send("Runtime.enable"); B.send("Debugger.enable"); B.send("NodeRuntime.enable");
  await wait(400);
  // A sends a binary frame: Debugger#error closes A's native connection.
  ev.push(`${at()} A sends a BINARY frame`);
  A.binary();
  await wait(300);
  B.send("Runtime.runIfWaitingForDebugger");

  // B leaves only once the runtime tells it the context is gone.
  const to = ms => new Promise(r => setTimeout(() => r(null), ms));
  await Promise.race([B.gotSignal.promise, to(4000)]);
  const bTold = B.saw.contextDestroyed || B.saw.waitingForDisconnect;
  B.close(); A.close();
  const exited = await c.waitExit(5000);
  c.kill(); await wait(80);
  return { name: "binary-frame-retires-session", ev, bTold, exited, code: c.code, notice: c.notice() };
}

async function rowLateOptIn() {
  const ev = []; const t0 = Date.now(); const at = () => `+${String(Date.now() - t0).padStart(5)}ms`;
  const c = await boot(ev, at);
  const A = session(await upgrade(c.port, c.wsPath), "A", ev, at);
  const B = session(await upgrade(c.port, c.wsPath), "B", ev, at);
  A.send("Runtime.enable"); A.send("Debugger.enable"); A.send("NodeRuntime.enable");
  A.send("NodeRuntime.notifyWhenWaitingForDisconnect", { enabled: true });
  B.send("Runtime.enable"); B.send("Debugger.enable"); B.send("NodeRuntime.enable");
  await wait(400);
  A.send("Runtime.runIfWaitingForDebugger");

  const to = ms => new Promise(r => setTimeout(() => r(null), ms));
  // Wait for the handshake to actually begin (A is the notify session).
  await Promise.race([A.gotSignal.promise, to(4000)]);
  ev.push(`${at()} handshake started (A saw waitingForDisconnect=${A.saw.waitingForDisconnect})`);

  // C attaches mid-handshake and opts in. It must not be able to keep B
  // from ever hearing that the context went away.
  let C = null;
  try {
    C = session(await upgrade(c.port, c.wsPath), "C", ev, at);
    C.send("Runtime.enable"); C.send("NodeRuntime.enable");
    C.send("NodeRuntime.notifyWhenWaitingForDisconnect", { enabled: true });
    ev.push(`${at()} C attached mid-handshake and opted in`);
    await wait(400);
  } catch (e) { ev.push(`${at()} C attach failed: ${e.message}`); }

  ev.push(`${at()} A leaves (last session retaining the context at handshake time)`);
  A.close();
  await Promise.race([B.gotSignal.promise, to(4000)]);
  const bTold = B.saw.contextDestroyed;
  B.close(); if (C) C.close();
  const exited = await c.waitExit(5000);
  c.kill(); await wait(80);
  return { name: "late-optin-must-not-suppress", ev, bTold, exited, code: c.code, notice: c.notice() };
}

const rows = [await rowBinaryFrame(), await rowLateOptIn()];
for (const r of rows) {
  console.log(`\n##### ${r.name} #####`);
  for (const e of r.ev) console.log("   " + e);
  console.log(`   >>> B was told the context is gone = ${r.bTold}; exited=${r.exited} code=${r.code} notice=${r.notice}`);
}
console.log("\n================ SUMMARY ================");
let bad = 0;
for (const r of rows) {
  const ok = r.bTold && r.exited && r.code === 55;
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${r.name.padEnd(30)} bTold=${String(r.bTold).padEnd(5)} exited=${String(r.exited).padEnd(5)} code=${r.code}`);
}
console.log(bad === 0 ? "PASS  no cross-session session can strand another one"
                      : `FAIL  ${bad} row(s) stranded a session`);
process.exit(bad === 0 ? 0 : 1);
