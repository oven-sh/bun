// Fix #3: process._debugEnd() suppresses the exit handshake, and a later
// inspector.open() must re-arm it. Bun's _debugEnd leaves the listener up, so
// that second open() takes the "already listening" early return — the clear has
// to happen before it.
// Usage: node debugend_open.mjs <BIN>
import { spawn } from "child_process";
import http from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

const BIN = process.argv[2];
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");
const wait = ms => new Promise(r => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l5do-"));

const body = reopen => `
const insp = require('inspector');
insp.open(0, '127.0.0.1', false);
process._debugEnd();
${reopen ? "insp.close(); insp.open(0, '127.0.0.1', false);" : ""}
console.log('URL ' + insp.url());
process.stdin.once('data', () => { console.log('ran'); process.exitCode = 55; process.stdin.pause(); });
`;
const F = {
  reopened: (p => (fs.writeFileSync(p, body(true)), p))(path.join(dir, "reopen.js")),
  ended: (p => (fs.writeFileSync(p, body(false)), p))(path.join(dir, "ended.js")),
};

const get = (port, p) => new Promise((res, rej) => {
  const r = http.get({ port, family: 4, path: p }, x => { let b = ""; x.setEncoding("utf8"); x.on("data", c => (b += c)).on("end", () => res(b)); });
  r.on("error", rej);
});
const upgrade = (port, p) => new Promise((res, rej) => {
  const r = http.get({ port, family: 4, path: p, headers: { Connection: "Upgrade", Upgrade: "websocket",
    "Sec-WebSocket-Version": 13, "Sec-WebSocket-Key": crypto.randomBytes(16).toString("base64") } });
  r.on("upgrade", (m, sock) => res(sock)); r.on("response", x => rej(new Error("status " + x.statusCode))); r.on("error", rej);
});
function txt(obj) {
  const p = Buffer.from(JSON.stringify(obj)), mask = crypto.randomBytes(4), h = [0x81];
  if (p.length < 126) h.push(0x80 | p.length); else h.push(0x80 | 126, p.length >> 8, p.length & 0xff);
  return Buffer.concat([Buffer.from(h), mask, Buffer.from(p.map((b, i) => b ^ mask[i % 4]))]);
}

async function run(name, file) {
  const child = spawn(BIN, [file], { stdio: ["pipe", "pipe", "pipe"] , cwd: dir });
  let out = "", err = "", exited = false, code = null;
  let resolveUrl; const urlP = new Promise(r => (resolveUrl = r));
  child.stdout.on("data", d => { out += String(d); const m = out.match(/URL (ws:\/\/\S+)/); if (m) resolveUrl(m[1]); });
  child.stderr.on("data", d => { err += strip(String(d)); });
  child.on("exit", c => { exited = true; code = c; });
  const to = ms => new Promise(r => setTimeout(() => r(null), ms));
  const waitExit = async ms => { const end = Date.now() + ms; while (!exited && Date.now() < end) await wait(25); return exited; };

  const raw = await Promise.race([urlP, to(8000)]);
  if (!raw) { console.log(`${name.padEnd(22)} NO URL (stderr: ${err.slice(0, 120)})`); child.kill("SIGKILL"); return null; }
  const u = new URL(raw);
  let wsPath = u.pathname;
  try { wsPath = new URL(JSON.parse(await get(u.port, "/json/list"))[0].webSocketDebuggerUrl).pathname; } catch {}
  const sock = await upgrade(u.port, wsPath);
  sock.on("error", () => {}); sock.on("data", () => {});
  let id = 0;
  sock.write(txt({ id: ++id, method: "Runtime.enable", params: {} }));
  sock.write(txt({ id: ++id, method: "NodeRuntime.enable", params: {} }));
  await wait(300);

  child.stdin.write("go\n");
  const blocked = !(await waitExit(2500));
  sock.destroy();
  const done = await waitExit(5000);
  if (!exited) { try { child.kill("SIGKILL"); } catch {} }
  await wait(80);
  const notice = err.includes("Waiting for the debugger to disconnect...");
  console.log(`${name.padEnd(22)} handshake=${String(notice).padEnd(5)} blockedWhileAttached=${String(blocked).padEnd(5)} exited=${String(done).padEnd(5)} code=${code}`);
  return { notice, blocked, exited: done, code };
}

const reopened = await run("_debugEnd+open", F.reopened);
const ended = await run("_debugEnd only", F.ended);

console.log("\n================ SUMMARY ================");
// open() after _debugEnd re-arms the handshake (Node re-creates the agent).
const ok1 = reopened && reopened.notice === true && reopened.blocked === true && reopened.exited && reopened.code === 55;
// _debugEnd alone suppresses it (Node: io_ == nullptr, no wait at all).
const ok2 = ended && ended.notice === false && ended.blocked === false && ended.exited && ended.code === 55;
console.log(`${ok1 ? "PASS" : "FAIL"}  inspector.open() after _debugEnd re-arms the exit handshake`);
console.log(`${ok2 ? "PASS" : "FAIL"}  _debugEnd alone still suppresses it`);
process.exit(ok1 && ok2 ? 0 : 1);
