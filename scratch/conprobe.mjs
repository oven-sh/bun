// Console/exception stack-frame coordinate probe.
import { spawn } from "child_process"; import http from "http"; import crypto from "crypto";
const BIN = process.argv[2];
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");
const wait = ms => new Promise(r => setTimeout(r, ms));
const SCRIPT = `function inner() { console.trace('T'); }\nfunction outer() { inner(); }\nouter();\nsetTimeout(() => { throw new Error('boom'); }, 5);\n`;
const child = spawn(BIN, ["--inspect-brk=0", "-e", SCRIPT], { stdio: ["ignore", "pipe", "pipe"] });
child.stdout.on("data", () => {}); let buf = "";
const url = await new Promise((res, rej) => { child.stderr.on("data", d => { buf += strip(String(d)); const m = buf.match(/ws:\/\/\S+/); if (m) res(m[0]); }); setTimeout(() => rej(new Error("no banner")), 10000); });
const u = new URL(url);
const get = p => new Promise((res, rej) => { const r = http.get({ port: u.port, family: 4, path: p }, x => { let b = ""; x.on("data", c => b += c).on("end", () => res(b)); }); r.on("error", rej); });
let wsPath = u.pathname; try { wsPath = new URL(JSON.parse(await get("/json/list"))[0].webSocketDebuggerUrl).pathname; } catch {}
const sock = await new Promise((res, rej) => { const r = http.get({ port: u.port, family: 4, path: wsPath, headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": 13, "Sec-WebSocket-Key": crypto.randomBytes(16).toString("base64") } }); r.on("upgrade", (m, s) => res(s)); r.on("error", rej); r.on("response", x => rej(new Error("s" + x.statusCode))); });
function fr(o){const p=Buffer.from(JSON.stringify(o)),mask=crypto.randomBytes(4),h=[0x81];
 if(p.length<126)h.push(0x80|p.length);else if(p.length<65536)h.push(0x80|126,p.length>>8,p.length&0xff);
 else{h.push(0x80|127);const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(p.length));for(const x of b)h.push(x);}
 return Buffer.concat([Buffer.from(h),mask,Buffer.from(p.map((b,i)=>b^mask[i%4]))]);}
let acc = Buffer.alloc(0), id = 0; const evs = [];
const send = (m, p = {}) => sock.write(fr({ id: ++id, method: m, params: p }));
sock.on("data", d => { acc = Buffer.concat([acc, d]);
 for(;;){ if(acc.length<2)return; const l0=acc[1]&0x7f; let len=l0,hdr=2;
  if(l0===126){if(acc.length<4)return;len=acc.readUInt16BE(2);hdr=4;}
  else if(l0===127){if(acc.length<10)return;len=Number(acc.readBigUInt64BE(2));hdr=10;}
  if(acc.length<hdr+len)return; const b=acc.slice(hdr,hdr+len).toString(); acc=acc.slice(hdr+len);
  if(!b)continue; let o; try{o=JSON.parse(b);}catch{continue;}
  if(o.method==="Runtime.consoleAPICalled"||o.method==="Runtime.exceptionThrown")evs.push(o); }});
send("NodeRuntime.enable"); await wait(200); send("Runtime.enable"); send("Debugger.enable");
send("Debugger.setAsyncCallStackDepth", { maxDepth: 10 }); await wait(200); send("Runtime.runIfWaitingForDebugger");
await wait(2500);
for (const e of evs) {
  const st = e.params.stackTrace ?? e.params.exceptionDetails?.stackTrace;
  if (!st) continue;
  console.log(e.method, "desc=" + JSON.stringify(st.description), st.callFrames.map(f => `${f.functionName||'(anon)'}@${f.url}:${f.lineNumber}:${f.columnNumber}`).join(" | "));
  if (st.parent) console.log("   parent desc=" + JSON.stringify(st.parent.description), st.parent.callFrames.map(f => `${f.functionName||'(anon)'}:${f.lineNumber}`).join(" | "));
}
try { child.kill("SIGKILL"); } catch {}
process.exit(0);
