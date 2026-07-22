// What script URL does the runtime report for each entry shape, and does it
// round-trip through setBreakpointByUrl / getScriptSource?
import { spawn } from "child_process";
import http from "http";
import crypto from "crypto";
const BIN = process.argv[2];
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");
const CODE = "let q = 1;\nconsole.log('hi', q);\n";

function start(args, stdinScript) {
  const child = spawn(BIN, args, { stdio: [stdinScript ? "pipe" : "ignore", "pipe", "pipe"] });
  if (stdinScript) { child.stdin.write(stdinScript); child.stdin.end(); }
  let buf = "";
  const ready = new Promise((res, rej) => {
    child.stderr.on("data", d => {
      buf += strip(String(d));
      const m = buf.match(/Debugger listening on (ws:\/\/\S+)/);
      if (m) res(m[1]);
    });
    setTimeout(() => rej(new Error("no banner")), 8000);
  });
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

async function probe(label, args, stdinScript) {
  const { child, ready } = start(args, stdinScript);
  let url; try { url = await ready; } catch (e) { console.log(`${label}: NO BANNER (${e.message})`); child.kill(); return; }
  const u = new URL(url);
  const list = JSON.parse(await get(u.port, "/json/list"));
  const sock = await upgrade(u.port, new URL(list[0].webSocketDebuggerUrl).pathname);
  const scripts = [], replies = new Map();
  let acc = Buffer.alloc(0), id = 0;
  sock.on("data", d => {
    acc = Buffer.concat([acc, d]);
    for (;;) {
      if (acc.length < 2) return;
      const l0 = acc[1] & 0x7f; let len = l0, hdr = 2;
      if (l0 === 126) { if (acc.length < 4) return; len = acc.readUInt16BE(2); hdr = 4; }
      else if (l0 === 127) { if (acc.length < 10) return; len = Number(acc.readBigUInt64BE(2)); hdr = 10; }
      if (acc.length < hdr + len) return;
      const body = acc.slice(hdr, hdr + len).toString(); acc = acc.slice(hdr + len);
      let o; try { o = JSON.parse(body); } catch { continue; }
      if (o.method === "Debugger.scriptParsed") scripts.push({ id: o.params.scriptId, url: o.params.url });
      else if (o.id) replies.set(o.id, o);
    }
  });
  const send = (method, params = {}) => { const i = ++id; sock.write(fr({ id: i, method, params })); return i; };
  const call = async (method, params) => { const i = send(method, params); for (let n = 0; n < 60 && !replies.has(i); n++) await wait(50); return replies.get(i); };
  send("Runtime.enable"); send("Debugger.enable"); send("NodeRuntime.enable");
  await wait(300);
  send("Runtime.runIfWaitingForDebugger");
  await wait(700);
  // The user script: not a node:/bun: internal, not the adapter's own wrappers.
  const user = scripts.filter(s => s.url && !s.url.startsWith("node:") && !s.url.startsWith("bun:") && !s.url.includes("/internal/") && !s.url.endsWith("-wrapper"));
  console.log(`\n${label}`);
  console.log(`  scriptParsed urls: ${JSON.stringify(user.map(s => s.url))}`);
  const target = user[0];
  if (target) {
    const src = await call("Debugger.getScriptSource", { scriptId: target.id });
    console.log(`  getScriptSource(scriptId=${target.id}) -> ${src?.result ? JSON.stringify(String(src.result.scriptSource).slice(0, 30)) : JSON.stringify(src?.error)}`);
    const bp = await call("Debugger.setBreakpointByUrl", { lineNumber: 1, url: target.url });
    console.log(`  setBreakpointByUrl(url=${JSON.stringify(target.url)}) -> ${bp?.result ? "id=" + bp.result.breakpointId + " locations=" + JSON.stringify(bp.result.locations) : JSON.stringify(bp?.error)}`);
  }
  sock.destroy(); child.kill();
}

await probe("node -e", ["--inspect-brk=0", "-e", CODE]);
await probe("node --eval", ["--inspect-brk=0", "--eval", CODE]);
await probe("node -p", ["--inspect-brk=0", "-p", "1+1"]);
await probe("stdin (dash)", ["--inspect-brk=0", "-"], CODE);
await probe("file", ["--inspect-brk=0", "/Users/ciro/code/bun/.claude/worktrees/wave-insp/scratch/evalfile.js"]);
process.exit(0);
