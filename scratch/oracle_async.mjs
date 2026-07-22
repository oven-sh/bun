// Async-stack-trace oracle. Usage: node oracle_async.mjs <BIN> <scenario> [maxDepth]
// scenario: interval | then
import { spawn } from "child_process";
import http from "http";
import crypto from "crypto";

const BIN = process.argv[2];
const SCENARIO = process.argv[3];
const MAXDEPTH = process.argv[4] === undefined ? 10 : Number(process.argv[4]);
const CLIENT = process.env.A_CLIENT || "cdp"; // cdp | jsc
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");
const wait = ms => new Promise(r => setTimeout(r, ms));

const SCRIPTS = {
  interval: `setInterval(() => { debugger; }, 50);`,
  chain: `setTimeout(function a() { setTimeout(function b() { setTimeout(function c() { debugger; }, 5); }, 5); }, 5);`,
  then: `runTest();
function runTest() {
  const p = Promise.resolve();
  p.then(function break1() { // lineNumber 3
    debugger;
  });
  p.then(function break2() { // lineNumber 6
    debugger;
  });
}
`,
};
const script = SCRIPTS[SCENARIO];
if (script === undefined) { console.error("unknown scenario"); process.exit(2); }

const child = spawn(BIN, ["--inspect-brk=0", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
let buf = "";
child.stdout.on("data", () => {});
const ready = new Promise((res, rej) => {
  child.stderr.on("data", d => {
    buf += strip(String(d));
    const m = buf.match(/Debugger listening on (ws:\/\/\S+)/);
    if (m) res(m[1]);
  });
  setTimeout(() => rej(new Error("no banner: " + buf)), 10000);
});

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
  if (p.length < 126) h.push(0x80 | p.length);
  else if (p.length < 65536) h.push(0x80 | 126, p.length >> 8, p.length & 0xff);
  else { h.push(0x80 | 127); const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(p.length)); for (const x of b) h.push(x); }
  return Buffer.concat([Buffer.from(h), mask, Buffer.from(p.map((b, i) => b ^ mask[i % 4]))]);
}

const url = await ready;
const u = new URL(url);
let wsPath = u.pathname;
if (CLIENT === "cdp") {
  try { const list = JSON.parse(await get(u.port, "/json/list")); wsPath = new URL(list[0].webSocketDebuggerUrl).pathname; } catch {}
}
const sock = await upgrade(u.port, wsPath);
let acc = Buffer.alloc(0), id = 0;
const pauses = [];
const replies = new Map();
const send = (method, params = {}) => { const n = ++id; sock.write(fr({ id: n, method, params })); return n; };
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
    if (o.id !== undefined) { replies.set(o.id, o); continue; }
    if (o.method === "Debugger.paused") pauses.push(o.params);
  }
});

if (CLIENT === "jsc") {
  send("Inspector.enable"); send("Runtime.enable"); send("Debugger.enable");
  const d = send("Debugger.setAsyncStackTraceDepth", { depth: MAXDEPTH });
  await wait(400);
  console.log("JSC setAsyncStackTraceDepth reply:", JSON.stringify(replies.get(d)));
  send("Inspector.initialized");
} else {
  send("NodeRuntime.enable");
  await wait(300);
  send("Runtime.enable"); send("Debugger.enable");
  const d = send("Debugger.setAsyncCallStackDepth", { maxDepth: MAXDEPTH });
  send("Debugger.setBlackboxPatterns", { patterns: [] });
  await wait(300);
  console.log("setAsyncCallStackDepth reply:", JSON.stringify(replies.get(d)));
  send("Runtime.runIfWaitingForDebugger");
}
await wait(600);
// first pause = break on start; resume through it, then capture the next 2
let seen = 0;
for (let i = 0; i < 40 && pauses.length < 3; i++) {
  if (pauses.length > seen) { seen = pauses.length; send("Debugger.resume"); }
  await wait(150);
}
await wait(300);
console.log(`### BIN=${BIN} SCENARIO=${SCENARIO} CLIENT=${CLIENT} MAXDEPTH=${MAXDEPTH} pauses=${pauses.length}`);
pauses.forEach((p, i) => {
  console.log(`--- pause[${i}] keys=${Object.keys(p).join(",")}`);
  console.log(`    top frame: ${p.callFrames?.[0]?.functionName} @${p.callFrames?.[0]?.location?.lineNumber}`);
  console.log("    asyncStackTrace = " + JSON.stringify(p.asyncStackTrace, null, 2));
});
try { child.kill("SIGKILL"); } catch {}
process.exit(0);
