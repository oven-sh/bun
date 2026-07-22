// Oracle probe: node's exit handshake (L5). Records CDP frames + stderr order.
import { spawn } from "child_process";
import http from "http";
import crypto from "crypto";
const BIN = process.argv[2];
const VARIANT = process.argv[3] || "plain"; // plain | notify
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");
const events = [];
const t0 = Date.now();
const at = () => `+${String(Date.now() - t0).padStart(4)}ms`;

function start() {
  const child = spawn(BIN, ["--inspect-brk=0", "-e", "console.log('ran'); process.exitCode = 55;"], { stdio: ["ignore", "pipe", "pipe"] });
  let buf = "";
  child.stdout.on("data", d => events.push(`${at()} STDOUT ${String(d).trim()}`));
  const ready = new Promise((res, rej) => {
    child.stderr.on("data", d => {
      const text = strip(String(d));
      buf += text;
      for (const line of text.split("\n")) if (line.trim()) events.push(`${at()} STDERR ${line.trim()}`);
      const m = buf.match(/Debugger listening on (ws:\/\/\S+)/);
      if (m) res(m[1]);
    });
    setTimeout(() => rej(new Error("no banner")), 8000);
  });
  child.on("exit", (code, sig) => events.push(`${at()} PROCESS EXIT code=${code} signal=${sig}`));
  return { child, ready };
}
const get = (port, path) => new Promise((res, rej) => {
  const r = http.get({ port, family: 4, path }, x => { let b = ""; x.setEncoding("utf8"); x.on("data", c => (b += c)).on("end", () => res(b)); });
  r.on("error", rej);
});
const upgrade = (port, path) => new Promise((res, rej) => {
  const r = http.get({ port, family: 4, path, headers: { Connection: "Upgrade", Upgrade: "websocket",
    "Sec-WebSocket-Version": 13, "Sec-WebSocket-Key": crypto.randomBytes(16).toString("base64") } });
  r.on("upgrade", (m, sock) => res(sock)); r.on("response", x => rej(new Error("status " + x.statusCode))); r.on("error", rej);
});
function fr(obj) {
  const p = Buffer.from(JSON.stringify(obj)), mask = crypto.randomBytes(4), h = [0x81];
  if (p.length < 126) h.push(0x80 | p.length); else h.push(0x80 | 126, p.length >> 8, p.length & 0xff);
  return Buffer.concat([Buffer.from(h), mask, Buffer.from(p.map((b, i) => b ^ mask[i % 4]))]);
}
const wait = ms => new Promise(r => setTimeout(r, ms));

const { child, ready } = start();
const url = await ready; const u = new URL(url);
const list = JSON.parse(await get(u.port, "/json/list"));
const sock = await upgrade(u.port, new URL(list[0].webSocketDebuggerUrl).pathname);
let acc = Buffer.alloc(0);
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
    if (o.method === "Debugger.paused") { events.push(`${at()} CDP  Debugger.paused -> resuming`); sock.write(fr({ id: ++id, method: "Debugger.resume", params: {} })); continue; }
    if (o.method) events.push(`${at()} CDP  ${o.method} ${JSON.stringify(o.params ?? {}).slice(0, 70)}`);
  }
});
let id = 0; const send = (method, params = {}) => sock.write(fr({ id: ++id, method, params }));
send("Runtime.enable"); send("Debugger.enable"); send("NodeRuntime.enable");
if (VARIANT === "notify") send("NodeRuntime.notifyWhenWaitingForDisconnect", { enabled: true });
await wait(400);
events.push(`${at()} --- sending Runtime.runIfWaitingForDebugger (program will finish) ---`);
send("Runtime.runIfWaitingForDebugger");
await wait(3000);
events.push(`${at()} --- still alive? closing socket now ---`);
sock.destroy();
await wait(1500);
console.log(`VARIANT=${VARIANT}`);
for (const e of events) console.log("  " + e);
child.kill();
process.exit(0);
