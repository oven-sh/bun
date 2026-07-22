// Raw JSC-endpoint probe: dump the backend's own Debugger.paused payload.
import { spawn } from "child_process";
import http from "http"; import crypto from "crypto";
const BIN = process.argv[2], SCENARIO = process.argv[3];
const DEPTH = process.argv[4] === undefined ? 10 : Number(process.argv[4]);
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");
const wait = ms => new Promise(r => setTimeout(r, ms));
const SCRIPTS = {
  interval: `setInterval(() => { debugger; }, 50);`,
  then: `runTest();\nfunction runTest() {\n  const p = Promise.resolve();\n  p.then(function break1() { // lineNumber 3\n    debugger;\n  });\n  p.then(function break2() { // lineNumber 6\n    debugger;\n  });\n}\n`,
  chain: `setTimeout(function a() { setTimeout(function b() { setTimeout(function c() { debugger; }, 5); }, 5); }, 5);`,
};
const child = spawn(BIN, ["--inspect-brk=0", "-e", SCRIPTS[SCENARIO]], { stdio: ["ignore", "pipe", "pipe"] });
child.stdout.on("data", () => {});
let buf = "";
const ready = new Promise((res, rej) => { child.stderr.on("data", d => { buf += strip(String(d)); const m = buf.match(/ws:\/\/\S+/); if (m) res(m[0]); }); setTimeout(() => rej(new Error("no banner "+buf)), 10000); });
const upgrade = (port, p) => new Promise((res, rej) => {
  const r = http.get({ port, family: 4, path: p, headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": 13, "Sec-WebSocket-Key": crypto.randomBytes(16).toString("base64") } });
  r.on("upgrade", (m, s) => res(s)); r.on("response", x => rej(new Error("status " + x.statusCode))); r.on("error", rej);
});
function fr(o){const p=Buffer.from(JSON.stringify(o)),mask=crypto.randomBytes(4),h=[0x81];
 if(p.length<126)h.push(0x80|p.length);else if(p.length<65536)h.push(0x80|126,p.length>>8,p.length&0xff);
 else{h.push(0x80|127);const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(p.length));for(const x of b)h.push(x);}
 return Buffer.concat([Buffer.from(h),mask,Buffer.from(p.map((b,i)=>b^mask[i%4]))]);}
const url = await ready; const u = new URL(url);
const sock = await upgrade(u.port, u.pathname);
let acc = Buffer.alloc(0), id = 0; const pauses = [], out = [];
const send = (m, p = {}) => { const n = ++id; sock.write(fr({ id: n, method: m, params: p })); return n; };
sock.on("data", d => { acc = Buffer.concat([acc, d]);
  for(;;){ if(acc.length<2)return; const l0=acc[1]&0x7f; let len=l0,hdr=2;
    if(l0===126){if(acc.length<4)return;len=acc.readUInt16BE(2);hdr=4;}
    else if(l0===127){if(acc.length<10)return;len=Number(acc.readBigUInt64BE(2));hdr=10;}
    if(acc.length<hdr+len)return; const body=acc.slice(hdr,hdr+len).toString(); acc=acc.slice(hdr+len);
    if(!body)continue; let o; try{o=JSON.parse(body);}catch{continue;}
    if(o.id!==undefined){out.push("REPLY "+JSON.stringify(o).slice(0,220));continue;}
    if(o.method==="Debugger.paused"){pauses.push(o.params);}
    else if(o.method)out.push("EVENT "+o.method); }});
send("Inspector.enable"); send("Runtime.enable"); send("Debugger.enable");
await wait(500);
send("Debugger.setAsyncStackTraceDepth", { depth: DEPTH });
await wait(300);
send("Inspector.initialized");
await wait(600);
let seen = 0;
for (let i = 0; i < 40 && pauses.length < 3; i++) { if (pauses.length > seen) { seen = pauses.length; send("Debugger.resume"); } await wait(150); }
await wait(300);
console.log(`### JSC-RAW ${SCENARIO} depth=${DEPTH} pauses=${pauses.length}`);
for (const o of out) console.log(o);
pauses.forEach((p, i) => console.log(`--- pause[${i}] keys=${Object.keys(p)}\n    asyncStackTrace=${JSON.stringify(p.asyncStackTrace, null, 1)}`));
try { child.kill("SIGKILL"); } catch {}
process.exit(0);
