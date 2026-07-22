// L5 safety matrix, part 3: the Pending-connection race.
//
// A frontend that opens the WS in the exit window is inserted Pending, and its
// connect() task is posted to the JS thread that is about to park in the
// handshake. If the handshake loop does not connect it inline, that frontend
// gets no reply to anything it sends, so a real DevTools never closes and the
// process spins forever.
//
// The frontends here behave like real ones: each closes only after the runtime
// has actually answered it.
//
// Usage: node matrix_l5c.mjs <BIN> [iterations]
import { spawn } from "child_process";
import http from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

const BIN = process.argv[2];
const ITERS = Number(process.argv[3] || 20);
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");
const wait = ms => new Promise(r => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l5r-"));
// A little tail work after the resume widens the window in which B can attach
// while the script is still running, so B is Pending when exit snapshots it.
const script = path.join(dir, "nat.js");
fs.writeFileSync(script, `
let x = 0;
for (let i = 0; i < 4e6; i++) x += i;
console.log('ran ' + (x > 0));
process.exitCode = 55;
`);

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
function pump(sock, onFrame) {
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
      onFrame(o);
    }
  });
}

async function iteration(i) {
  const jitter = i % 13;
  const child = spawn(BIN, ["--inspect-brk=0", script], { stdio: ["ignore", "pipe", "pipe"], cwd: dir });
  let buf = "", err = "", exited = false, code = null;
  child.stdout.on("data", () => {});
  let resolveCdp;
  const cdpUrl = new Promise(r => (resolveCdp = r));
  child.stderr.on("data", d => {
    const t = strip(String(d)); buf += t; err += t;
    const c = buf.match(/Debugger listening on (ws:\/\/\S+)/); if (c) resolveCdp(c[1]);
  });
  child.on("exit", c => { exited = true; code = c; });
  const to = ms => new Promise(r => setTimeout(() => r(null), ms));
  // exited may already be true — child.once('exit') would never fire then.
  const waitExit = async ms => {
    const deadline = Date.now() + ms;
    while (!exited && Date.now() < deadline) await wait(25);
    return exited;
  };

  const u = new URL((await Promise.race([cdpUrl, to(8000)])) || "ws://x/x");
  const list = JSON.parse(await get(u.port, "/json/list"));
  const wsPath = new URL(list[0].webSocketDebuggerUrl).pathname;

  // Frontend A: leaves once it sees the handshake event.
  const a = await upgrade(u.port, wsPath);
  let aId = 0;
  const aSend = (m, p = {}) => a.write(fr({ id: ++aId, method: m, params: p }));
  const aSawHandshake = Promise.withResolvers();
  pump(a, o => {
    if (o.method === "Debugger.paused") a.write(fr({ id: ++aId, method: "Debugger.resume", params: {} }));
    if (o.method === "Runtime.executionContextDestroyed" || o.method === "NodeRuntime.waitingForDisconnect") aSawHandshake.resolve();
  });
  aSend("Runtime.enable"); aSend("Debugger.enable"); aSend("NodeRuntime.enable");
  await wait(300);

  // Frontend B races the window. Like DevTools it will not act until the
  // runtime has answered its Runtime.enable.
  let b = null;
  const bReplied = Promise.withResolvers();
  const bTask = (async () => {
    await wait(jitter);
    try {
      b = await upgrade(u.port, wsPath);
      pump(b, o => { if (o.id === 1) bReplied.resolve("answered"); });
      b.write(fr({ id: 1, method: "Runtime.enable", params: {} }));
    } catch { bReplied.resolve("attach-failed"); }
  })();
  aSend("Runtime.runIfWaitingForDebugger");
  await bTask;

  await Promise.race([aSawHandshake.promise, to(4000)]);
  a.destroy();

  // The load-bearing question: with only B (attached in the exit window) left,
  // does the child still get out? A real DevTools would not close on its own.
  const exitedWithBAttached = await waitExit(4000);
  const bAnswered = await Promise.race([bReplied.promise, Promise.resolve().then(() => null)]);

  if (b) b.destroy();
  const exitedEventually = await waitExit(5000);
  if (!exited) { try { child.kill("SIGKILL"); } catch {} }
  await wait(60);

  return {
    i, jitter,
    exitedWithBAttached, exitedEventually, code,
    bAnswered: bAnswered || "no reply",
    msg: err.includes("Waiting for the debugger to disconnect..."),
  };
}

const rows = [];
for (let i = 0; i < ITERS; i++) rows.push(await iteration(i));

console.log("iter jit exitedWhileBAttached exitedEventually code msg  B");
for (const r of rows) {
  console.log(`${String(r.i).padStart(4)} ${String(r.jitter).padStart(3)} ${String(r.exitedWithBAttached).padStart(20)} ${String(r.exitedEventually).padStart(16)} ${String(r.code).padStart(4)} ${String(r.msg).padStart(5)}  ${r.bAnswered}`);
}
// A frontend that is still attached SHOULD hold the process open — that is the
// feature. The failures that matter are a permanent wedge, a wrong exit code,
// or a frontend that took part in the handshake yet was never answered.
const held = rows.filter(r => !r.exitedWithBAttached);
const neverExited = rows.filter(r => !r.exitedEventually);
const wrongCode = rows.filter(r => r.exitedEventually && r.code !== 55);
const starved = rows.filter(r => !r.exitedWithBAttached && r.bAnswered === "no reply");
console.log("\n================ SUMMARY ================");
console.log(`iterations                                        : ${rows.length}`);
console.log(`held open by the late frontend (expected, not a bug): ${held.length}`);
console.log(`never exited at all                               : ${neverExited.length}`);
console.log(`exited with the wrong code                        : ${wrongCode.length}`);
console.log(`held open AND never answered (the starvation bug) : ${starved.length}`);
const ok = neverExited.length === 0 && wrongCode.length === 0 && starved.length === 0;
console.log(ok ? "PASS  a frontend attaching in the exit window is answered and never wedges exit"
               : "FAIL  a frontend attaching in the exit window can wedge exit unanswered");
process.exit(ok ? 0 : 1);
