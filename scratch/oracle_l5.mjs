// L5 oracle: exit handshake across scenarios. Usage: node oracle_l5.mjs <BIN> <scenario> [notify]
import { spawn } from "child_process";
import http from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

const BIN = process.argv[2];
const SCENARIO = process.argv[3];
const NOTIFY = process.argv[4] === "notify";
const CLIENT = process.env.L5_CLIENT || "cdp"; // cdp | jsc | none
const FLAG = process.env.L5_FLAG || "--inspect-brk=0";
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");
const events = [];
const t0 = Date.now();
const at = () => `+${String(Date.now() - t0).padStart(5)}ms`;
const wait = ms => new Promise(r => setTimeout(r, ms));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l5-"));
const w = (n, s) => { const p = path.join(dir, n); fs.writeFileSync(p, s); return p; };

w("wkchild.js", `setTimeout(()=>{},10);`);
const SCENARIOS = {
  natural: [w("nat.js", `console.log('ran'); process.exitCode = 55;`)],
  exit: [w("ex.js", `console.log('ran'); process.exit(55);`)],
  uncaught: [w("unc.js", `console.log('ran'); setTimeout(()=>{ throw new Error('boom'); }, 10);`)],
  worker: [w("wk.js", `const {Worker}=require('worker_threads');
console.log('ran');
const wk=new Worker(${JSON.stringify(path.join(dir, "wkchild.js"))});
wk.on('exit', c => { console.log('worker exit '+c); process.exitCode = 55; });`)],
  close: [w("cl.js", `const insp=require('inspector'); console.log('ran');
setTimeout(()=>{ insp.close(); process.exitCode = 55; }, 10);`)],
  plain: [w("pl.js", `console.log('ran'); process.exitCode = 55;`)],
};

const scriptArgs = SCENARIOS[SCENARIO];
if (!scriptArgs) { console.error("unknown scenario " + SCENARIO); process.exit(2); }

const args = FLAG === "none" ? scriptArgs : [FLAG, ...scriptArgs];
const child = spawn(BIN, args, { stdio: ["ignore", "pipe", "pipe"], cwd: dir });
let buf = "";
child.stdout.on("data", d => { for (const l of String(d).split("\n")) if (l.trim()) events.push(`${at()} STDOUT ${l.trim()}`); });
const ready = new Promise((res, rej) => {
  child.stderr.on("data", d => {
    const text = strip(String(d));
    buf += text;
    for (const l of text.split("\n")) if (l.trim()) events.push(`${at()} STDERR ${l.trim()}`);
    const m = buf.match(/Debugger listening on (ws:\/\/\S+)/);
    if (m) res(m[1]);
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

const finish = async () => {
  await wait(2500);
  console.log(`SCENARIO=${SCENARIO} CLIENT=${CLIENT} NOTIFY=${NOTIFY} FLAG=${FLAG}`);
  for (const e of events) console.log("  " + e);
  console.log(`  RESULT exited=${exited}`);
  try { child.kill("SIGKILL"); } catch {}
  process.exit(0);
};

let url;
try { url = await ready; } catch (e) { events.push(`${at()} NO BANNER: ${e.message}`); await finish(); }
const u = new URL(url);

if (CLIENT === "none") {
  await wait(3000);
  events.push(`${at()} --- never attached ---`);
  await finish();
}

let wsPath;
if (CLIENT === "jsc") {
  wsPath = u.pathname;
} else {
  const list = JSON.parse(await get(u.port, "/json/list"));
  wsPath = new URL(list[0].webSocketDebuggerUrl).pathname;
}
const sock = await upgrade(u.port, wsPath);
events.push(`${at()} --- attached (${CLIENT}) at ${wsPath} ---`);
let acc = Buffer.alloc(0);
let id = 0;
const send = (method, params = {}) => sock.write(fr({ id: ++id, method, params }));
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
    if (o.method) events.push(`${at()} CDP  ${o.method} ${JSON.stringify(o.params ?? {}).slice(0, 90)}`);
  }
});

if (CLIENT === "jsc") {
  sock.write(fr({ id: ++id, method: "Inspector.enable", params: {} }));
  sock.write(fr({ id: ++id, method: "Runtime.enable", params: {} }));
  sock.write(fr({ id: ++id, method: "Debugger.enable", params: {} }));
  await wait(300);
  sock.write(fr({ id: ++id, method: "Inspector.initialized", params: {} }));
  sock.write(fr({ id: ++id, method: "Debugger.resume", params: {} }));
} else {
  send("Runtime.enable"); send("Debugger.enable"); send("NodeRuntime.enable");
  if (NOTIFY) send("NodeRuntime.notifyWhenWaitingForDisconnect", { enabled: true });
  await wait(400);
  events.push(`${at()} --- Runtime.runIfWaitingForDebugger ---`);
  send("Runtime.runIfWaitingForDebugger");
}

await wait(3000);
if (exited) { events.push(`${at()} --- already exited while attached ---`); await finish(); }
events.push(`${at()} --- still alive; destroying socket ---`);
sock.destroy();
await finish();
