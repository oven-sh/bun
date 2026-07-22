// Reproduce one wedged iteration and sample the child's stacks.
import { spawn, spawnSync } from "child_process";
import http from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

const BIN = process.argv[2];
const JITTER = Number(process.argv[3] ?? 6);
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");
const wait = ms => new Promise(r => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l5s-"));
const script = path.join(dir, "nat.js");
fs.writeFileSync(script, `console.log('ran'); process.exitCode = 55;`);

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
function pump(sock, label, onFrame) {
  let acc = Buffer.alloc(0);
  sock.on("error", () => {});
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
      console.log(`   [${label}] ${o.method ?? "reply id=" + o.id} ${JSON.stringify(o.params ?? o.result ?? {}).slice(0, 70)}`);
      onFrame(o);
    }
  });
}

const child = spawn(BIN, ["--inspect-brk=0", script], { stdio: ["ignore", "pipe", "pipe"], cwd: dir });
let buf = "";
let resolveCdp;
const cdpUrl = new Promise(r => (resolveCdp = r));
child.stdout.on("data", d => console.log("   STDOUT " + String(d).trim()));
child.stderr.on("data", d => {
  const t = strip(String(d)); buf += t;
  for (const l of t.split("\n")) if (l.trim()) console.log("   STDERR " + l.trim());
  const c = buf.match(/Debugger listening on (ws:\/\/\S+)/); if (c) resolveCdp(c[1]);
});
let exited = false;
child.on("exit", (c, s) => { exited = true; console.log(`   EXIT code=${c} signal=${s}`); });

const u = new URL(await cdpUrl);
const list = JSON.parse(await get(u.port, "/json/list"));
const wsPath = new URL(list[0].webSocketDebuggerUrl).pathname;

const a = await upgrade(u.port, wsPath);
let aId = 0;
const aSend = (m, p = {}) => a.write(fr({ id: ++aId, method: m, params: p }));
pump(a, "A", o => { if (o.method === "Debugger.paused") a.write(fr({ id: ++aId, method: "Debugger.resume", params: {} })); });
aSend("Runtime.enable"); aSend("Debugger.enable"); aSend("NodeRuntime.enable");
await wait(300);

let b = null;
const bTask = (async () => {
  await wait(JITTER);
  b = await upgrade(u.port, wsPath);
  console.log("   >>> B attached");
  let bId = 0;
  pump(b, "B", () => {});
  b.write(fr({ id: ++bId, method: "Runtime.enable", params: {} }));
})();
console.log("   >>> runIfWaitingForDebugger");
aSend("Runtime.runIfWaitingForDebugger");
await bTask.catch(e => console.log("   B attach failed " + e.message));

await wait(2500);
console.log("   >>> closing A");
a.destroy();
await wait(2500);
console.log(`   >>> exited after A left? ${exited}`);
if (!exited) {
  console.log("   >>> SAMPLING CHILD " + child.pid);
  const s = spawnSync("sample", [String(child.pid), "2", "-mayDie"], { encoding: "utf8" });
  const txt = s.stdout || s.stderr || "";
  // print the main thread + any thread mentioning the inspector
  const blocks = txt.split(/\n(?=    \d+ Thread_)/);
  for (const blk of blocks) {
    if (/Thread_.*(Main Thread|DispatchQueue_1)/.test(blk) || /Inspector|Debugger|waitForDebuggerToDisconnect|BunInspector/.test(blk)) {
      console.log(blk.split("\n").slice(0, 45).join("\n"));
      console.log("   ---");
    }
  }
  console.log("   >>> closing B");
  if (b) b.destroy();
  await wait(2500);
  console.log(`   >>> exited after B left? ${exited}`);
}
try { child.kill("SIGKILL"); } catch {}
process.exit(0);
