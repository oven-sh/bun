import { spawn } from "child_process";
import http from "http";
import crypto from "crypto";
const BIN = process.argv[2], FLAG = process.argv[3];
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");
const CODE = "setInterval(() => { debugger; }, 50);";
const child = spawn(BIN, [FLAG, "-e", CODE], { stdio: ["ignore", "pipe", "pipe"] });
let buf = "";
const url = await new Promise((res, rej) => { child.stderr.on("data", d => { buf += strip(String(d)); const m = buf.match(/Debugger listening on (ws:\/\/\S+)/); if (m) res(m[1]); }); setTimeout(() => rej(new Error("no banner")), 8000); });
const u = new URL(url);
const list = await new Promise(r => http.get({ port: u.port, family: 4, path: "/json/list" }, x => { let b = ""; x.on("data", c => (b += c)).on("end", () => r(JSON.parse(b))); }));
const sock = await new Promise((res, rej) => { const r = http.get({ port: u.port, family: 4, path: new URL(list[0].webSocketDebuggerUrl).pathname, headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": 13, "Sec-WebSocket-Key": crypto.randomBytes(16).toString("base64") } }); r.on("upgrade", (m, s) => res(s)); r.on("error", rej); r.on("response", x => rej(new Error("status " + x.statusCode))); });
function fr(o) { const p = Buffer.from(JSON.stringify(o)), mk = crypto.randomBytes(4), h = [0x81]; if (p.length < 126) h.push(0x80 | p.length); else h.push(0x80 | 126, p.length >> 8, p.length & 0xff); return Buffer.concat([Buffer.from(h), mk, Buffer.from(p.map((b, i) => b ^ mk[i % 4]))]); }
const parsed = []; const replies = new Map(); let acc = Buffer.alloc(0), id = 0;
sock.on("data", d => { acc = Buffer.concat([acc, d]);
  for (;;) { if (acc.length < 2) return; const l0 = acc[1] & 0x7f; let len = l0, hdr = 2;
    if (l0 === 126) { if (acc.length < 4) return; len = acc.readUInt16BE(2); hdr = 4; }
    else if (l0 === 127) { if (acc.length < 10) return; len = Number(acc.readBigUInt64BE(2)); hdr = 10; }
    if (acc.length < hdr + len) return; const body = acc.slice(hdr, hdr + len).toString(); acc = acc.slice(hdr + len);
    let o; try { o = JSON.parse(body); } catch { continue; }
    if (o.method === "Debugger.scriptParsed") parsed.push(o.params); else if (o.id) replies.set(o.id, o); } });
const send = (m, p = {}) => { const i = ++id; sock.write(fr({ id: i, method: m, params: p })); return i; };
send("Runtime.enable"); send("Debugger.enable"); send("NodeRuntime.enable");
await new Promise(r => setTimeout(r, 300)); send("Runtime.runIfWaitingForDebugger");
await new Promise(r => setTimeout(r, 800));
const user = parsed.filter(p => p.url && !p.url.startsWith("node:") && !p.url.includes("/internal/"));
for (const p of user) {
  const i = send("Debugger.getScriptSource", { scriptId: p.scriptId });
  await new Promise(r => setTimeout(r, 400));
  const src = replies.get(i)?.result?.scriptSource ?? "";
  console.log(`  url=${JSON.stringify(p.url)} startLine=${p.startLine} sourceMapURL=${JSON.stringify((p.sourceMapURL||"").slice(0,40))}`);
  console.log(`    source[0..80]=${JSON.stringify(src.slice(0, 160))}`);
}
sock.destroy(); child.kill(); process.exit(0);
