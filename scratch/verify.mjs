import { spawn } from "child_process";
import http from "http";
import crypto from "crypto";

const BUN = "/Users/ciro/code/bun/.claude/worktrees/wave-insp/build/release/bun";
const SCRIPT = "/Users/ciro/code/bun/.claude/worktrees/wave-insp/scratch/loop.js";

function strip(s) { return s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, ""); }

function startChild(flags) {
  const child = spawn(BUN, [...flags, SCRIPT], { stdio: ["ignore", "pipe", "pipe"] });
  let buf = "", out = "";
  child.stdout.on("data", d => (out += d));
  const banners = {};
  const ready = new Promise(res => {
    child.stderr.on("data", d => {
      buf += strip(String(d));
      const node = buf.match(/Debugger listening on (ws:\/\/\S+)/);
      const jsc = buf.match(/Listening:\s*\n\s*(ws:\/\/\S+)/);
      if (node && jsc) { banners.node = node[1]; banners.jsc = jsc[1]; res(banners); }
    });
  });
  return { child, ready, stdout: () => out, stderrBuf: () => buf };
}

function get(port, path, headers) {
  return new Promise((res, rej) => {
    const req = http.get({ port, family: 4, path, headers }, r => {
      let b = ""; r.setEncoding("utf8");
      r.on("data", c => (b += c)).on("end", () => res({ status: r.statusCode, body: b }));
    });
    req.on("error", rej);
  });
}

function upgrade(port, path, key) {
  return new Promise(res => {
    const req = http.get({ port, family: 4, path, headers: {
      Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": 13, "Sec-WebSocket-Key": key } });
    req.on("upgrade", (m, sock) => res({ upgraded: true, status: m.statusCode, socket: sock, headers: m.headers }));
    req.on("response", r => { r.resume(); res({ upgraded: false, status: r.statusCode }); });
    req.on("error", e => res({ upgraded: false, error: e.message }));
  });
}

function wsFrame(obj) {
  const payload = Buffer.from(JSON.stringify(obj));
  const mask = crypto.randomBytes(4);
  const head = [];
  head.push(0x81);
  if (payload.length < 126) head.push(0x80 | payload.length);
  else { head.push(0x80 | 126, payload.length >> 8, payload.length & 0xff); }
  const masked = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
  return Buffer.concat([Buffer.from(head), mask, masked]);
}
function parseFrames(buf) {
  const msgs = [];
  let off = 0;
  while (off + 2 <= buf.length) {
    const len0 = buf[off + 1] & 0x7f;
    let len = len0, hdr = 2;
    if (len0 === 126) { len = buf.readUInt16BE(off + 2); hdr = 4; }
    else if (len0 === 127) { len = Number(buf.readBigUInt64BE(off + 2)); hdr = 10; }
    if (off + hdr + len > buf.length) break;
    const body = buf.slice(off + hdr, off + hdr + len).toString();
    if ((buf[off] & 0x0f) === 1) msgs.push(body);
    off += hdr + len;
  }
  return { msgs, rest: buf.slice(off) };
}

const results = [];
function report(name, ok, detail) {
  results.push([name, ok, detail]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
}

// --- A: CLI inspector: banner + /json/list + key== upgrade
{
  const { child, ready } = startChild(["--inspect-brk=0"]);
  const b = await Promise.race([ready, new Promise(r => setTimeout(() => r(null), 8000))]);
  if (!b) { report("A banner", false, "no banner"); child.kill(); }
  else {
    report("A banner (node format)", /^ws:\/\/.+:\d+\/.+/.test(b.node), b.node);
    const port = new URL(b.node).port;
    const list = await get(port, "/json/list");
    let target;
    try { target = JSON.parse(list.body)[0]; } catch {}
    report("A /json/list has webSocketDebuggerUrl", !!target?.webSocketDebuggerUrl, target?.webSocketDebuggerUrl);
    // Host part is Host-header-derived while the banner advertises 127.0.0.1,
    // exactly like node; the CDP pathname is what must match.
    report("A /json/list points at CDP path", !!target?.webSocketDebuggerUrl && new URL(target.webSocketDebuggerUrl).pathname === new URL(b.node).pathname, `${target?.webSocketDebuggerUrl} vs ${b.node}`);
    const up = await upgrade(port, new URL(b.node).pathname, "key==");
    report("A upgrade with 'key==' -> 101", up.upgraded === true, `status=${up.status} err=${up.error ?? ""}`);
    if (up.upgraded) {
      let acc = Buffer.alloc(0), got = [];
      up.socket.on("data", d => { acc = Buffer.concat([acc, d]); const p = parseFrames(acc); acc = p.rest; got.push(...p.msgs); });
      up.socket.write(wsFrame({ id: 1, method: "Runtime.enable" }));
      up.socket.write(wsFrame({ id: 2, method: "Debugger.enable" }));
      await new Promise(r => setTimeout(r, 1500));
      const parsed = got.map(m => { try { return JSON.parse(m); } catch { return {}; } });
      report("A CDP Runtime.enable answered", parsed.some(m => m.id === 1 && m.result !== undefined), JSON.stringify(got.slice(0, 2)).slice(0, 200));
      report("A CDP Debugger.enable answered", parsed.some(m => m.id === 2 && m.result !== undefined), JSON.stringify(parsed.filter(m => m.id === 2)).slice(0, 200));
      up.socket.destroy();
    }
    child.kill();
  }
}

// --- B: JSC endpoint intact (debug.bun.sh flow) on the same server
{
  const { child, ready, stdout } = startChild(["--inspect-brk=0"]);
  const b = await Promise.race([ready, new Promise(r => setTimeout(() => r(null), 8000))]);
  if (!b) { report("B jsc", false, "no banner"); child.kill(); }
  else {
    const u = new URL(b.jsc);
    const key = crypto.randomBytes(16).toString("base64");
    const up = await upgrade(u.port, u.pathname, key);
    report("B JSC path upgrade (valid key) -> 101", up.upgraded === true, `status=${up.status}`);
    if (up.upgraded) {
      let acc = Buffer.alloc(0); const got = [];
      up.socket.on("data", d => { acc = Buffer.concat([acc, d]); const p = parseFrames(acc); acc = p.rest; got.push(...p.msgs); });
      up.socket.write(wsFrame({ id: 1, method: "Inspector.enable" }));
      up.socket.write(wsFrame({ id: 2, method: "Inspector.initialized" }));
      await new Promise(r => setTimeout(r, 2000));
      const parsed = got.map(m => { try { return JSON.parse(m); } catch { return {}; } });
      report("B JSC Inspector.enable answered", parsed.some(m => m.id === 1 && m.result !== undefined), JSON.stringify(parsed.slice(0, 3)).slice(0, 300));
      report("B JSC client resumes --inspect-brk (program ran)", stdout().includes("tick") || stdout().length > 0, JSON.stringify(stdout().slice(0, 80)));
      up.socket.destroy();
    }
    child.kill();
  }
}

// --- C: a normal Bun.serve must still reject key==
{
  const srv = spawn(BUN, ["-e", `
    const s = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req, server) {
      if (server.upgrade(req)) return; return new Response(null, { status: 426 });
    }, websocket: { open(){}, message(){} } });
    console.log("PORT=" + s.port + "");
  `], { stdio: ["ignore", "pipe", "pipe"] });
  const port = await new Promise(res => { let b = ""; srv.stdout.on("data", d => { b += d; const m = b.replace(/\x1b\[[0-9;]*m/g, "").match(/PORT=(\d+)/); if (m) res(m[1]); }); });
  const up = await upgrade(port, "/", "key==");
  report("C plain Bun.serve rejects 'key==' ", up.upgraded === false && up.status === 426, `upgraded=${up.upgraded} status=${up.status}`);
  const up2 = await upgrade(port, "/", crypto.randomBytes(16).toString("base64"));
  report("C plain Bun.serve accepts valid key", up2.upgraded === true, `status=${up2.status}`);
  if (up2.socket) up2.socket.destroy();
  srv.kill();
}

console.log("\n" + results.filter(r => r[1]).length + "/" + results.length + " checks passed");
process.exit(results.every(r => r[1]) ? 0 : 1);
