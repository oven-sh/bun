// L5 safety matrix, part 2: JSC-protocol clients must never take part in the
// exit handshake. Usage: node matrix_l5b.mjs <BIN>
import { spawn } from "child_process";
import http from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

const BIN = process.argv[2];
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");
const wait = ms => new Promise(r => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l5j-"));
const script = path.join(dir, "nat.js");
fs.writeFileSync(script, `console.log('ran'); process.exitCode = 55;`);

const get = (port, p) => new Promise((res, rej) => {
  const r = http.get({ port, family: 4, path: p }, x => { let b = ""; x.setEncoding("utf8"); x.on("data", c => (b += c)).on("end", () => res(b)); });
  r.on("error", rej);
});
const upgrade = (port, p, hdrs = {}) => new Promise((res, rej) => {
  const r = http.get({ port, family: 4, path: p, headers: { Connection: "Upgrade", Upgrade: "websocket",
    "Sec-WebSocket-Version": 13, "Sec-WebSocket-Key": crypto.randomBytes(16).toString("base64"), ...hdrs } });
  r.on("upgrade", (m, sock) => res(sock)); r.on("response", x => rej(new Error("status " + x.statusCode))); r.on("error", rej);
});
function fr(obj) {
  const p = Buffer.from(JSON.stringify(obj)), mask = crypto.randomBytes(4), h = [0x81];
  if (p.length < 126) h.push(0x80 | p.length); else h.push(0x80 | 126, p.length >> 8, p.length & 0xff);
  return Buffer.concat([Buffer.from(h), mask, Buffer.from(p.map((b, i) => b ^ mask[i % 4]))]);
}
function reader(sock, label, ev, at) {
  let acc = Buffer.alloc(0), id = 0;
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
      if (o.method === "Debugger.scriptParsed") continue;
      if (o.method === "Debugger.paused") { ev.push(`${at()} [${label}] paused -> resume`); sock.write(fr({ id: ++id, method: "Debugger.resume", params: {} })); continue; }
      if (o.method) ev.push(`${at()} [${label}] ${o.method} ${JSON.stringify(o.params ?? {}).slice(0, 60)}`);
    }
  });
  return (m, p = {}) => sock.write(fr({ id: ++id, method: m, params: p }));
}

async function row(name, mode) {
  const ev = []; const t0 = Date.now();
  const at = () => `+${String(Date.now() - t0).padStart(5)}ms`;
  const child = spawn(BIN, ["--inspect-brk=0", script], { stdio: ["ignore", "pipe", "pipe"], cwd: dir });
  let buf = "", err = "", exited = false, code = null;
  child.stdout.on("data", d => { for (const l of String(d).split("\n")) if (l.trim()) ev.push(`${at()} STDOUT ${l.trim()}`); });
  let resolveJsc, resolveCdp;
  const jscUrl = new Promise(r => (resolveJsc = r));
  const cdpUrl = new Promise(r => (resolveCdp = r));
  child.stderr.on("data", d => {
    const t = strip(String(d)); buf += t; err += t;
    for (const l of t.split("\n")) if (l.trim()) ev.push(`${at()} STDERR ${l.trim()}`);
    const j = buf.match(/Listening:\s*\n?\s*(ws:\/\/\S+)/); if (j) resolveJsc(j[1]);
    const c = buf.match(/Debugger listening on (ws:\/\/\S+)/); if (c) resolveCdp(c[1]);
  });
  child.on("exit", (c, s) => { exited = true; code = c; ev.push(`${at()} EXIT code=${c} signal=${s}`); });
  const to = ms => new Promise(r => setTimeout(() => r(null), ms));

  const ju = await Promise.race([jscUrl, to(8000)]);
  if (!ju) { ev.push("NO JSC BANNER"); }
  const u = new URL(ju);
  const socks = [];

  // JSC-protocol client on the JSC pathname (what debug.bun.sh speaks)
  const jsock = await upgrade(u.port, u.pathname);
  socks.push(jsock);
  const jsend = reader(jsock, "jsc", ev, at);
  ev.push(`${at()} attached JSC at ${u.pathname}`);
  jsend("Inspector.enable"); jsend("Runtime.enable"); jsend("Debugger.enable");
  await wait(250);
  jsend("Inspector.initialized");
  jsend("Debugger.resume");

  let csock = null;
  if (mode === "both") {
    const cu = new URL(await Promise.race([cdpUrl, to(3000)]));
    const list = JSON.parse(await get(cu.port, "/json/list"));
    csock = await upgrade(cu.port, new URL(list[0].webSocketDebuggerUrl).pathname);
    socks.push(csock);
    const csend = reader(csock, "cdp", ev, at);
    ev.push(`${at()} attached CDP`);
    csend("Runtime.enable"); csend("Debugger.enable"); csend("NodeRuntime.enable");
    await wait(300);
    csend("Runtime.runIfWaitingForDebugger");
  }

  const early = await Promise.race([new Promise(r => child.once("exit", () => r(true))), to(3000)]);
  ev.push(`${at()} after 3s attached: exited=${!!early}`);

  if (mode === "both" && !exited) {
    ev.push(`${at()} dropping CDP socket only (JSC stays)`);
    csock.destroy();
    const afterCdp = await Promise.race([new Promise(r => child.once("exit", () => r(true))), to(2500)]);
    ev.push(`${at()} after CDP drop: exited=${!!afterCdp}`);
  }
  if (!exited) { ev.push(`${at()} dropping remaining sockets`); for (const s of socks) s.destroy(); }
  await Promise.race([new Promise(r => child.once("exit", () => r(true))), to(6000)]);
  try { if (!exited) child.kill("SIGKILL"); } catch {}
  await wait(150);

  const msg = err.includes("Waiting for the debugger to disconnect...");
  console.log(`\n##### ${name} #####`);
  for (const e of ev) console.log("   " + e);
  console.log(`   >>> exited=${exited} code=${code} waitingMsg=${msg}`);
  return { name, exited, code, msg };
}

const r1 = await row("jsc-only-attached-through-exit", "jsc");
const r2 = await row("jsc-plus-cdp-attached", "both");
console.log("\n================ SUMMARY ================");
// jsc-only: must exit; and must NOT print the handshake message (JSC clients
// do not participate). Note a JSC connection refs the event loop by design,
// so the process legitimately stays alive until that client detaches.
const ok1 = r1.exited && r1.code === 55 && !r1.msg;
const ok2 = r2.exited && r2.code === 55;
console.log(`${ok1 ? "PASS" : "FAIL"}  ${r1.name}  exited=${r1.exited} code=${r1.code} waitingMsg=${r1.msg} (want false)`);
console.log(`${ok2 ? "PASS" : "FAIL"}  ${r2.name}  exited=${r2.exited} code=${r2.code} waitingMsg=${r2.msg}`);
process.exit(ok1 && ok2 ? 0 : 1);
