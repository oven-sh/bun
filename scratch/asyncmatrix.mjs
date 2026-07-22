// Boundary-type matrix: for each async boundary, print the engine's asyncStackTrace shape.
import { spawn } from "child_process";
import http from "http"; import crypto from "crypto";
const BIN = process.argv[2];
const ONLY = process.argv[3];
const DEPTH = process.argv[4] === undefined ? 10 : Number(process.argv[4]);
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");
const wait = ms => new Promise(r => setTimeout(r, ms));
const S = {
  setTimeout:    `setTimeout(() => { debugger; }, 5);`,
  setInterval:   `setInterval(() => { debugger; }, 20);`,
  setImmediate:  `setImmediate(() => { debugger; });`,
  promiseThen:   `Promise.resolve().then(() => { debugger; });`,
  promiseCatch:  `Promise.reject(new Error('x')).catch(() => { debugger; });`,
  promiseFinally:`Promise.resolve().finally(() => { debugger; });`,
  queueMicrotask:`queueMicrotask(() => { debugger; });`,
  nextTick:      `process.nextTick(() => { debugger; });`,
  awaitFn:       `(async () => { await Promise.resolve(); debugger; })();`,
  eventEmitter:  `const {EventEmitter}=require('events'); const e=new EventEmitter(); e.on('x',()=>{debugger;}); setTimeout(()=>e.emit('x'),5);`,
  fsCallback:    `require('fs').readFile(__filename||'/etc/hosts', () => { debugger; });`,
};
async function run(name) {
  const child = spawn(BIN, ["--inspect-brk=0", "-e", S[name]], { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", () => {}); let buf = "";
  const ready = new Promise((res, rej) => { child.stderr.on("data", d => { buf += strip(String(d)); const m = buf.match(/ws:\/\/\S+/); if (m) res(m[0]); }); setTimeout(() => rej(new Error("no banner")), 10000); });
  let url; try { url = await ready; } catch { child.kill("SIGKILL"); return `${name}: NO BANNER`; }
  const u = new URL(url);
  const get = p => new Promise((res, rej) => { const r = http.get({ port: u.port, family: 4, path: p }, x => { let b = ""; x.on("data", c => b += c).on("end", () => res(b)); }); r.on("error", rej); });
  let wsPath = u.pathname;
  try { wsPath = new URL(JSON.parse(await get("/json/list"))[0].webSocketDebuggerUrl).pathname; } catch {}
  const sock = await new Promise((res, rej) => { const r = http.get({ port: u.port, family: 4, path: wsPath, headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": 13, "Sec-WebSocket-Key": crypto.randomBytes(16).toString("base64") } }); r.on("upgrade", (m, s) => res(s)); r.on("error", rej); r.on("response", x => rej(new Error("s" + x.statusCode))); });
  function fr(o){const p=Buffer.from(JSON.stringify(o)),mask=crypto.randomBytes(4),h=[0x81];
    if(p.length<126)h.push(0x80|p.length);else if(p.length<65536)h.push(0x80|126,p.length>>8,p.length&0xff);
    else{h.push(0x80|127);const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(p.length));for(const x of b)h.push(x);}
    return Buffer.concat([Buffer.from(h),mask,Buffer.from(p.map((b,i)=>b^mask[i%4]))]);}
  let acc = Buffer.alloc(0), id = 0; const pauses = [];
  const send = (m, p = {}) => sock.write(fr({ id: ++id, method: m, params: p }));
  sock.on("data", d => { acc = Buffer.concat([acc, d]);
    for(;;){ if(acc.length<2)return; const l0=acc[1]&0x7f; let len=l0,hdr=2;
      if(l0===126){if(acc.length<4)return;len=acc.readUInt16BE(2);hdr=4;}
      else if(l0===127){if(acc.length<10)return;len=Number(acc.readBigUInt64BE(2));hdr=10;}
      if(acc.length<hdr+len)return; const b=acc.slice(hdr,hdr+len).toString(); acc=acc.slice(hdr+len);
      if(!b)continue; let o; try{o=JSON.parse(b);}catch{continue;}
      if(o.method==="Debugger.paused")pauses.push(o.params); }});
  send("NodeRuntime.enable"); await wait(250);
  send("Runtime.enable"); send("Debugger.enable");
  send("Debugger.setAsyncCallStackDepth", { maxDepth: DEPTH });
  send("Debugger.setBlackboxPatterns", { patterns: [] });
  await wait(250); send("Runtime.runIfWaitingForDebugger");
  let seen = 0;
  for (let i = 0; i < 30 && pauses.length < 2; i++) { if (pauses.length > seen) { seen = pauses.length; send("Debugger.resume"); } await wait(120); }
  try { child.kill("SIGKILL"); } catch {}
  const p = pauses[1];
  if (!p) return `${name}: no second pause (pauses=${pauses.length})`;
  const a = p.asyncStackTrace;
  if (!a) return `${name}: asyncStackTrace ABSENT`;
  const f = a.callFrames?.[0] ?? {};
  const levels = []; let x = a; while (x) { levels.push(JSON.stringify(x.description)); x = x.parent; }
  return `${name}: desc=${JSON.stringify(a.description)} extraKeys=${Object.keys(a).filter(k=>!['description','callFrames','parent'].includes(k))} levels=[${levels}] frame0=${f.functionName}@${f.url}:${f.lineNumber}:${f.columnNumber} nframes=${a.callFrames?.length}`;
}
const names = ONLY && ONLY !== "all" ? [ONLY] : Object.keys(S);
for (const n of names) { try { console.log(await run(n)); } catch (e) { console.log(`${n}: ERROR ${e.message}`); } }
process.exit(0);
