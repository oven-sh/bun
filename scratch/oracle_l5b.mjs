// L5 oracle part 2: worker targets + inspector.close() timing, plus /json/list polling.
import { spawn } from "child_process";
import http from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

const BIN = process.argv[2];
const SCENARIO = process.argv[3];
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");
const events = [];
const t0 = Date.now();
const at = () => `+${String(Date.now() - t0).padStart(5)}ms`;
const wait = ms => new Promise(r => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l5b-"));
const w = (n, s) => { const p = path.join(dir, n); fs.writeFileSync(p, s); return p; };

w("wkchild.js", `setTimeout(()=>{ console.log('child done'); },10);`);
const SCENARIOS = {
  worker: [w("wk.js", `const {Worker}=require('worker_threads');
console.log('ran');
const wk=new Worker(${JSON.stringify(path.join(dir, "wkchild.js"))});
wk.on('exit', c => { console.log('worker exit '+c); process.exitCode = 55; });`)],
  close: [w("cl.js", `const insp=require('inspector'); console.log('ran');
setTimeout(()=>{ console.log('before close'); insp.close(); console.log('after close'); process.exitCode = 55; }, 10);`)],
};
const scriptArgs = SCENARIOS[SCENARIO];
const child = spawn(BIN, ["--inspect-brk=0", ...scriptArgs], { stdio: ["ignore", "pipe", "pipe"], cwd: dir });
let buf = "";
child.stdout.on("data", d => { for (const l of String(d).split("\n")) if (l.trim()) events.push(`${at()} STDOUT ${l.trim()}`); });
const ready = new Promise((res, rej) => {
  child.stderr.on("data", d => {
    const text = strip(String(d)); buf += text;
    for (const l of text.split("\n")) if (l.trim()) events.push(`${at()} STDERR ${l.trim()}`);
    const m = buf.match(/Debugger listening on (ws:\/\/\S+)/); if (m) res(m[1]);
  });
  setTimeout(() => rej(new Error("no banner")), 10000);
});
let exited = false;
child.on("exit", (code, sig) => { exited = true; events.push(`${at()} PROCESS EXIT code=${code} signal=${sig}`); });

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
function attach(sock, label) {
  let acc = Buffer.alloc(0); let id = 0;
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
      if (o.method === "Debugger.paused") { events.push(`${at()} [${label}] Debugger.paused -> resuming`); sock.write(fr({ id: ++id, method: "Debugger.resume", params: {} })); continue; }
      if (o.method) events.push(`${at()} [${label}] ${o.method} ${JSON.stringify(o.params ?? {}).slice(0, 80)}`);
    }
  });
  return (method, params = {}) => sock.write(fr({ id: ++id, method, params }));
}

const url = await ready; const u = new URL(url);
let list = JSON.parse(await get(u.port, "/json/list"));
events.push(`${at()} /json/list -> ${list.map(t => t.type + ":" + t.title).join(", ")}`);
const sock = await upgrade(u.port, new URL(list[0].webSocketDebuggerUrl).pathname);
const send = attach(sock, "main");
send("Runtime.enable"); send("Debugger.enable"); send("NodeRuntime.enable");
await wait(400);
events.push(`${at()} --- runIfWaitingForDebugger (main) ---`);
send("Runtime.runIfWaitingForDebugger");

// poll /json/list for new (worker) targets and attach+resume them
const seen = new Set(list.map(t => t.id));
const socks = [sock];
for (let i = 0; i < 20 && !exited; i++) {
  await wait(150);
  let l2; try { l2 = JSON.parse(await get(u.port, "/json/list")); } catch { break; }
  for (const t of l2) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    events.push(`${at()} NEW TARGET ${t.type} ${t.title} ${t.url}`);
    try {
      const s2 = await upgrade(u.port, new URL(t.webSocketDebuggerUrl).pathname);
      socks.push(s2);
      const s2send = attach(s2, "wk");
      s2send("Runtime.enable"); s2send("Debugger.enable"); s2send("NodeRuntime.enable");
      await wait(100);
      events.push(`${at()} --- runIfWaitingForDebugger (worker) ---`);
      s2send("Runtime.runIfWaitingForDebugger");
    } catch (e) { events.push(`${at()} attach worker failed: ${e.message}`); }
  }
}
await wait(2000);
if (!exited) {
  events.push(`${at()} --- destroying all ${socks.length} sockets ---`);
  for (const s of socks) s.destroy();
}
await wait(2500);
console.log(`SCENARIO=${SCENARIO}`);
for (const e of events) console.log("  " + e);
console.log(`  RESULT exited=${exited}`);
try { child.kill("SIGKILL"); } catch {}
process.exit(0);
