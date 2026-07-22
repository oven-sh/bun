// L5 safety matrix, part 5: the reconnecting client.
//
// VS Code auto-attach, chrome://inspect, any supervisor that re-attaches. The
// client here rolls its connection over WITH OVERLAP — it opens the replacement
// before dropping the old one — so at least one session exists at every instant.
//
// If the exit handshake keeps admitting new sessions instead of closing the
// listener first, the set it waits on never empties and the process never
// exits. There is no timeout behind it, and anything that can reach the
// inspector port can do this to an exiting bun.
//
// Node closes the listener (InspectorIo::StopAcceptingNewConnections) before
// waiting, so the rollover is refused and the process leaves.
//
// Usage: node matrix_l5e.mjs <BIN> [seconds]
import { spawn } from "child_process";
import http from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

const BIN = process.argv[2];
const BUDGET_MS = Number(process.argv[3] || 20) * 1000;
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");
const wait = ms => new Promise(r => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l5rc-"));
const script = path.join(dir, "nat.js");
fs.writeFileSync(script, `console.log('ran'); process.exitCode = 55;`);

const get = (port, p) => new Promise((res, rej) => {
  const r = http.get({ port, family: 4, path: p }, x => { let b = ""; x.setEncoding("utf8"); x.on("data", c => (b += c)).on("end", () => res(b)); });
  r.on("error", rej);
});
const upgrade = (port, p) => new Promise((res, rej) => {
  const r = http.get({ port, family: 4, path: p, headers: { Connection: "Upgrade", Upgrade: "websocket",
    "Sec-WebSocket-Version": 13, "Sec-WebSocket-Key": crypto.randomBytes(16).toString("base64") } });
  r.on("upgrade", (m, sock) => res(sock));
  r.on("response", x => rej(new Error("HTTP " + x.statusCode)));
  r.on("error", rej);
});
function txt(obj) {
  const p = Buffer.from(JSON.stringify(obj)), mask = crypto.randomBytes(4), h = [0x81];
  if (p.length < 126) h.push(0x80 | p.length); else h.push(0x80 | 126, p.length >> 8, p.length & 0xff);
  return Buffer.concat([Buffer.from(h), mask, Buffer.from(p.map((b, i) => b ^ mask[i % 4]))]);
}

let sawHandshake = false;
function attach(sock) {
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
      // Answer the --inspect-brk pause, or the child never reaches exit at all.
      if (o.method === "Debugger.paused") sock.write(txt({ id: ++id, method: "Debugger.resume", params: {} }));
      if (o.method === "Runtime.executionContextDestroyed" || o.method === "NodeRuntime.waitingForDisconnect") sawHandshake = true;
    }
  });
  const send = (m, p = {}) => sock.write(txt({ id: ++id, method: m, params: p }));
  send("Runtime.enable"); send("Debugger.enable"); send("NodeRuntime.enable");
  return send;
}

const child = spawn(BIN, ["--inspect-brk=0", script], { stdio: ["ignore", "pipe", "pipe"], cwd: dir });
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
const wsPath = new URL(list[0].webSocketDebuggerUrl).pathname;

// First session: let the program run so the child reaches its exit handshake.
let current = await upgrade(u.port, wsPath);
const send = attach(current);
await wait(350);
send("Runtime.runIfWaitingForDebugger");

// Wait until the child is actually parked in the handshake before rolling over,
// so the row tests the handshake rather than ordinary startup.
const start = Date.now();
while (!sawHandshake && !exited && Date.now() - start < 5000) await wait(25);
const reachedHandshake = sawHandshake && err.includes("Waiting for the debugger to disconnect...");

let rollovers = 0, refused = 0, lastRefusal = "";
const deadline = Date.now() + BUDGET_MS;
while (!exited && Date.now() < deadline) {
  let next = null;
  try {
    next = await upgrade(u.port, wsPath); // open the replacement FIRST
  } catch (e) {
    refused++; lastRefusal = e.message;
  }
  if (next) { rollovers++; attach(next); }
  try { current.destroy(); } catch {}   // only now drop the old one
  if (next) current = next;
  await wait(60);
}
const out = await waitExit(2000) || exited;
try { current.destroy(); } catch {}
if (!exited) { try { child.kill("SIGKILL"); } catch {} }
await wait(120);

const notice = err.includes("Waiting for the debugger to disconnect...");
console.log(`overlapping rollovers accepted    : ${rollovers}`);
console.log(`rollovers refused by the listener : ${refused}${lastRefusal ? " (last: " + lastRefusal + ")" : ""}`);
console.log(`handshake notice printed          : ${notice}`);
console.log(`a session was told about the exit : ${sawHandshake}`);
console.log(`exited within budget              : ${out} (code=${code})`);
console.log("\n================ SUMMARY ================");
const ok = out && code === 55 && reachedHandshake;
console.log(ok
  ? "PASS  an overlapping reconnect loop cannot keep the process alive"
  : !reachedHandshake
    ? "INCONCLUSIVE  the child never reached the exit handshake"
    : "FAIL  a reconnecting client pinned the process — unbounded hang");
process.exit(ok ? 0 : 1);
