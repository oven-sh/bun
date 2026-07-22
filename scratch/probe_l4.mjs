// Oracle probe: exact NodeRuntime.waitingForDebugger behavior. Run against node, then bun.
import { spawn } from "child_process";
import http from "http";
import crypto from "crypto";

const BIN = process.argv[2];
const SCRIPT = "/Users/ciro/code/bun/.claude/worktrees/wave-insp/scratch/loop.js";
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");

function start(flags) {
  const child = spawn(BIN, [...flags, SCRIPT], { stdio: ["ignore", "pipe", "pipe"] });
  let buf = "", out = "";
  child.stdout.on("data", d => (out += d));
  const ready = new Promise((res, rej) => {
    child.stderr.on("data", d => {
      buf += strip(String(d));
      const m = buf.match(/Debugger listening on (ws:\/\/\S+)/);
      if (m) res(m[1]);
    });
    setTimeout(() => rej(new Error("no banner")), 8000);
  });
  return { child, ready, out: () => out, err: () => buf };
}
function get(port, path) {
  return new Promise((res, rej) => {
    const r = http.get({ port, family: 4, path }, x => { let b = ""; x.setEncoding("utf8"); x.on("data", c => (b += c)).on("end", () => res(b)); });
    r.on("error", rej);
  });
}
function upgrade(port, path) {
  return new Promise((res, rej) => {
    const r = http.get({ port, family: 4, path, headers: { Connection: "Upgrade", Upgrade: "websocket",
      "Sec-WebSocket-Version": 13, "Sec-WebSocket-Key": crypto.randomBytes(16).toString("base64") } });
    r.on("upgrade", (m, sock) => res(sock));
    r.on("response", x => rej(new Error("no upgrade " + x.statusCode)));
    r.on("error", rej);
  });
}
function frame(obj) {
  const p = Buffer.from(JSON.stringify(obj)), mask = crypto.randomBytes(4), h = [0x81];
  if (p.length < 126) h.push(0x80 | p.length); else { h.push(0x80 | 126, p.length >> 8, p.length & 0xff); }
  return Buffer.concat([Buffer.from(h), mask, Buffer.from(p.map((b, i) => b ^ mask[i % 4]))]);
}
function reader(sock, log) {
  let acc = Buffer.alloc(0);
  sock.on("data", d => {
    acc = Buffer.concat([acc, d]);
    for (;;) {
      if (acc.length < 2) return;
      const l0 = acc[1] & 0x7f; let len = l0, hdr = 2;
      if (l0 === 126) { if (acc.length < 4) return; len = acc.readUInt16BE(2); hdr = 4; }
      else if (l0 === 127) { if (acc.length < 10) return; len = Number(acc.readBigUInt64BE(2)); hdr = 10; }
      if (acc.length < hdr + len) return;
      const body = acc.slice(hdr, hdr + len).toString();
      acc = acc.slice(hdr + len);
      if (body) log.push(body);
    }
  });
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const brief = m => { try { const o = JSON.parse(m); return o.method ? `NOTIF ${o.method}` : `REPLY id=${o.id} ${JSON.stringify(o.result).slice(0, 40)}`; } catch { return m.slice(0, 60); } };

async function session(port, path) {
  const sock = await upgrade(port, path);
  const log = [];
  reader(sock, log);
  let id = 0;
  return { sock, log, send: (method, params = {}) => { sock.write(frame({ id: ++id, method, params })); return id; },
           dump: (tag) => { console.log(`  [${tag}] ${log.length ? log.map(brief).join(" | ") : "(nothing)"}`); log.length = 0; } };
}

// --- Case 1: --inspect-brk (process IS waiting)
{
  console.log("CASE 1: --inspect-brk=0, NodeRuntime.enable while waiting");
  const { child, ready } = start(["--inspect-brk=0"]);
  const url = await ready; const u = new URL(url);
  const list = JSON.parse(await get(u.port, "/json/list"));
  const s = await session(u.port, new URL(list[0].webSocketDebuggerUrl).pathname);
  await wait(300); s.dump("on connect (before any command)");
  s.send("NodeRuntime.enable"); await wait(500); s.dump("after NodeRuntime.enable");
  s.send("NodeRuntime.enable"); await wait(500); s.dump("after 2nd NodeRuntime.enable (re-enable, still waiting)");
  s.send("NodeRuntime.disable"); await wait(300); s.dump("after NodeRuntime.disable");
  s.send("NodeRuntime.enable"); await wait(500); s.dump("after enable following disable");
  s.send("Runtime.runIfWaitingForDebugger"); await wait(700); s.dump("after runIfWaitingForDebugger");
  s.send("NodeRuntime.enable"); await wait(500); s.dump("after enable once no longer waiting");
  s.sock.destroy(); child.kill();
}
// --- Case 2: --inspect (NOT waiting)
{
  console.log("CASE 2: --inspect=0, NodeRuntime.enable while NOT waiting");
  const { child, ready } = start(["--inspect=0"]);
  const url = await ready; const u = new URL(url);
  await wait(600);
  const list = JSON.parse(await get(u.port, "/json/list"));
  const s = await session(u.port, new URL(list[0].webSocketDebuggerUrl).pathname);
  await wait(300); s.dump("on connect");
  s.send("NodeRuntime.enable"); await wait(600); s.dump("after NodeRuntime.enable");
  s.sock.destroy(); child.kill();
}
// --- Case 3: second session attaching while still waiting
{
  console.log("CASE 3: --inspect-brk=0, two sessions");
  const { child, ready } = start(["--inspect-brk=0"]);
  const url = await ready; const u = new URL(url);
  const list = JSON.parse(await get(u.port, "/json/list"));
  const path = new URL(list[0].webSocketDebuggerUrl).pathname;
  const s1 = await session(u.port, path);
  s1.send("NodeRuntime.enable"); await wait(500); s1.dump("session1 after enable");
  let s2;
  try { s2 = await session(u.port, path); } catch (e) { console.log("  session2 upgrade failed:", e.message); }
  if (s2) { s2.send("NodeRuntime.enable"); await wait(500); s2.dump("session2 after enable (attached while waiting)"); s2.sock.destroy(); }
  s1.sock.destroy(); child.kill();
}
// --- Case 4: exact raw wire text of the notification
{
  console.log("CASE 4: raw wire text");
  const { child, ready } = start(["--inspect-brk=0"]);
  const url = await ready; const u = new URL(url);
  const list = JSON.parse(await get(u.port, "/json/list"));
  const s = await session(u.port, new URL(list[0].webSocketDebuggerUrl).pathname);
  s.send("NodeRuntime.enable"); await wait(600);
  console.log("  raw:", JSON.stringify(s.log));
  s.sock.destroy(); child.kill();
}
process.exit(0);
