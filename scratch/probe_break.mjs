// Where does the runtime report the break-on-start pause for `-e` code?
import { spawn } from "child_process";
import http from "http";
import crypto from "crypto";
const BIN = process.argv[2];
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");
const CODE = "let q = 1;\nlet w = 2;\ndebugger;\nconsole.log('hi', q, w);\n";
const child = spawn(BIN, ["--inspect-brk=0", "-e", CODE], { stdio: ["ignore", "pipe", "pipe"] });
let buf = "";
const url = await new Promise((res, rej) => {
  child.stderr.on("data", d => { buf += strip(String(d)); const m = buf.match(/Debugger listening on (ws:\/\/\S+)/); if (m) res(m[1]); });
  setTimeout(() => rej(new Error("no banner")), 8000);
});
const u = new URL(url);
const list = await new Promise(r => http.get({ port: u.port, family: 4, path: "/json/list" }, x => { let b = ""; x.on("data", c => (b += c)).on("end", () => r(JSON.parse(b))); }));
const sock = await new Promise((res, rej) => {
  const r = http.get({ port: u.port, family: 4, path: new URL(list[0].webSocketDebuggerUrl).pathname, headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": 13, "Sec-WebSocket-Key": crypto.randomBytes(16).toString("base64") } });
  r.on("upgrade", (m, s) => res(s)); r.on("error", rej); r.on("response", x => rej(new Error("status " + x.statusCode)));
});
function fr(o) { const p = Buffer.from(JSON.stringify(o)), mk = crypto.randomBytes(4), h = [0x81];
  if (p.length < 126) h.push(0x80 | p.length); else h.push(0x80 | 126, p.length >> 8, p.length & 0xff);
  return Buffer.concat([Buffer.from(h), mk, Buffer.from(p.map((b, i) => b ^ mk[i % 4]))]); }
const scripts = new Map(); const pauses = []; let acc = Buffer.alloc(0), id = 0, paused = null;
sock.on("data", d => { acc = Buffer.concat([acc, d]);
  for (;;) { if (acc.length < 2) return; const l0 = acc[1] & 0x7f; let len = l0, hdr = 2;
    if (l0 === 126) { if (acc.length < 4) return; len = acc.readUInt16BE(2); hdr = 4; }
    else if (l0 === 127) { if (acc.length < 10) return; len = Number(acc.readBigUInt64BE(2)); hdr = 10; }
    if (acc.length < hdr + len) return;
    const body = acc.slice(hdr, hdr + len).toString(); acc = acc.slice(hdr + len);
    let o; try { o = JSON.parse(body); } catch { continue; }
    if (o.method === "Debugger.scriptParsed") scripts.set(o.params.scriptId, o.params.url);
    if (o.method === "Debugger.paused") { pauses.push(o.params); if (!paused) paused = o.params; } } });
const send = (m, p = {}) => sock.write(fr({ id: ++id, method: m, params: p }));
send("Runtime.enable"); send("Debugger.enable"); send("NodeRuntime.enable");
await new Promise(r => setTimeout(r, 300));
send("Runtime.runIfWaitingForDebugger");
await new Promise(r => setTimeout(r, 900));
send("Debugger.resume");
await new Promise(r => setTimeout(r, 900));
console.log("user code is: line0 'let q = 1;' line1 'let w = 2;' line2 'debugger;' line3 console.log");
for (const [i, p] of pauses.entries()) {
  const f = p.callFrames[0];
  console.log(`  pause#${i} reason=${p.reason} url=${JSON.stringify(scripts.get(f.location.scriptId))} line=${f.location.lineNumber} col=${f.location.columnNumber}`);
}
sock.destroy(); child.kill(); process.exit(0);
