// L5 safety matrix. Usage: node matrix_l5.mjs <BIN> [rowFilter]
// Every row must end with the child process EXITED. A row that reports
// exited=false is a hang and a hard failure.
import { spawn } from "child_process";
import http from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

const BIN = process.argv[2];
const FILTER = process.argv[3] || "";
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");
const wait = ms => new Promise(r => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l5m-"));
const w = (n, s) => { const p = path.join(dir, n); fs.writeFileSync(p, s); return p; };

w("wkchild.js", `setTimeout(()=>{ console.log('child done'); },10);`);
const F = {
  nat: w("nat.js", `console.log('ran'); process.exitCode = 55;`),
  exit: w("ex.js", `console.log('ran'); process.exit(55);`),
  unc: w("unc.js", `console.log('ran'); setTimeout(()=>{ throw new Error('boom'); }, 10);`),
  wk: w("wk.js", `const {Worker}=require('worker_threads');
console.log('ran');
const wk=new Worker(${JSON.stringify(path.join(dir, "wkchild.js"))});
wk.on('exit', c => { console.log('worker exit '+c); process.exitCode = 55; });`),
  close: w("cl.js", `const insp=require('inspector'); console.log('ran');
setTimeout(()=>{ console.log('before close'); insp.close(); console.log('after close'); process.exitCode = 55; }, 10);`),
  sess: w("sess.js", `const insp=require('inspector');
const s=new insp.Session(); s.connect();
console.log('ran'); process.exitCode = 55;`),
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
function fr(obj) {
  const p = Buffer.from(JSON.stringify(obj)), mask = crypto.randomBytes(4), h = [0x81];
  if (p.length < 126) h.push(0x80 | p.length); else h.push(0x80 | 126, p.length >> 8, p.length & 0xff);
  return Buffer.concat([Buffer.from(h), mask, Buffer.from(p.map((b, i) => b ^ mask[i % 4]))]);
}
const closeFrame = () => {
  const mask = crypto.randomBytes(4), pl = Buffer.from([0x03, 0xe8]);
  return Buffer.concat([Buffer.from([0x88, 0x82]), mask, Buffer.from(pl.map((b, i) => b ^ mask[i % 4]))]);
};

// row: { name, file, flag, client, notify, closeMode, killChildProbe }
async function run(row) {
  const ev = [];
  const t0 = Date.now();
  const at = () => `+${String(Date.now() - t0).padStart(5)}ms`;
  const args = row.flag ? [row.flag, row.file] : [row.file];
  const child = spawn(BIN, args, { stdio: ["ignore", "pipe", "pipe"], cwd: dir });
  let buf = "", out = "", err = "";
  let exited = false, code = null;
  child.stdout.on("data", d => { out += String(d); for (const l of String(d).split("\n")) if (l.trim()) ev.push(`${at()} STDOUT ${l.trim()}`); });
  const ready = new Promise(res => {
    child.stderr.on("data", d => {
      const t = strip(String(d)); buf += t; err += t;
      for (const l of t.split("\n")) if (l.trim()) ev.push(`${at()} STDERR ${l.trim()}`);
      const m = buf.match(/(?:Debugger listening on|Listening:\s*)\s*(ws:\/\/\S+)/);
      if (m) res(m[1]);
    });
  });
  child.on("exit", (c, s) => { exited = true; code = c; ev.push(`${at()} EXIT code=${c} signal=${s}`); });

  const timeout = ms => new Promise(r => setTimeout(() => r(null), ms));
  let waitedFor = null;
  try {
    if (row.client !== "none-noinsp") {
      const url = await Promise.race([ready, timeout(8000)]);
      if (!url) { ev.push(`${at()} NO BANNER`); }
      else {
        const u = new URL(url);
        if (row.client === "cdp" || row.client === "jsc") {
          let wsPath;
          if (row.client === "jsc") wsPath = u.pathname;
          else {
            const list = JSON.parse(await get(u.port, "/json/list"));
            wsPath = new URL(list[0].webSocketDebuggerUrl).pathname;
          }
          const sock = await upgrade(u.port, wsPath);
          ev.push(`${at()} attached ${row.client} ${wsPath}`);
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
              if (o.method === "Debugger.paused") { ev.push(`${at()} CDP Debugger.paused -> resume`); sock.write(fr({ id: ++id, method: "Debugger.resume", params: {} })); continue; }
              if (o.method) ev.push(`${at()} CDP ${o.method} ${JSON.stringify(o.params ?? {}).slice(0, 70)}`);
            }
          });
          const send = (m, p = {}) => sock.write(fr({ id: ++id, method: m, params: p }));
          if (row.client === "jsc") {
            send("Inspector.enable"); send("Runtime.enable"); send("Debugger.enable");
            await wait(300);
            send("Inspector.initialized"); send("Debugger.resume");
          } else {
            send("Runtime.enable"); send("Debugger.enable"); send("NodeRuntime.enable");
            if (row.notify) send("NodeRuntime.notifyWhenWaitingForDisconnect", { enabled: true });
            await wait(400);
            send("Runtime.runIfWaitingForDebugger");
          }
          // let the program run to completion (or block at exit)
          const finishedEarly = await Promise.race([
            new Promise(r => child.once("exit", () => r(true))), timeout(3000)]);
          waitedFor = finishedEarly ? "no (exited while attached)" : "yes (blocked with frontend attached)";
          if (!exited) {
            ev.push(`${at()} detaching via ${row.closeMode}`);
            if (row.closeMode === "frame") sock.write(closeFrame());
            else if (row.closeMode === "reset") sock.resetAndDestroy();
            else sock.destroy();
          }
        } else {
          // never attach
          await Promise.race([new Promise(r => child.once("exit", () => r(true))), timeout(4000)]);
        }
      }
    }
    await Promise.race([new Promise(r => child.once("exit", () => r(true))), timeout(6000)]);
  } catch (e) {
    ev.push(`${at()} PROBE ERROR ${e.message}`);
  }
  try { if (!exited) child.kill("SIGKILL"); } catch {}
  await wait(150);
  return { row, ev, exited, code, out, err, waitedFor };
}

const ROWS = [
  { name: "plain-no-inspector", file: F.nat, flag: null, client: "none-noinsp", expectCode: 55 },
  { name: "inspect-no-frontend", file: F.nat, flag: "--inspect=0", client: "none", expectCode: 55 },
  { name: "inspect-jsc-client", file: F.nat, flag: "--inspect=0", client: "jsc", expectCode: 55 },
  { name: "inspectbrk-cdp-natural", file: F.nat, flag: "--inspect-brk=0", client: "cdp", closeMode: "destroy", expectCode: 55 },
  { name: "inspectbrk-cdp-notify", file: F.nat, flag: "--inspect-brk=0", client: "cdp", notify: true, closeMode: "destroy", expectCode: 55 },
  { name: "process-exit-55", file: F.exit, flag: "--inspect-brk=0", client: "cdp", closeMode: "destroy", expectCode: 55 },
  { name: "uncaught-exception", file: F.unc, flag: "--inspect-brk=0", client: "cdp", closeMode: "destroy", expectCode: 1 },
  { name: "worker-exiting", file: F.wk, flag: "--inspect=0", client: "cdp", closeMode: "destroy", expectCode: 55 },
  { name: "inspector-close-race", file: F.close, flag: "--inspect-brk=0", client: "cdp", closeMode: "destroy", expectCode: 55 },
  { name: "in-process-session", file: F.sess, flag: null, client: "none-noinsp", expectCode: 55 },
  { name: "frontend-clean-closeframe", file: F.nat, flag: "--inspect-brk=0", client: "cdp", closeMode: "frame", expectCode: 55 },
  { name: "frontend-rst-no-closeframe", file: F.nat, flag: "--inspect-brk=0", client: "cdp", closeMode: "reset", expectCode: 55 },
];

const results = [];
for (const row of ROWS) {
  if (FILTER && !row.name.includes(FILTER)) continue;
  const r = await run(row);
  results.push(r);
  console.log(`\n##### ${row.name} (${row.flag || "no flag"}, client=${row.client}, close=${row.closeMode || "-"}) #####`);
  for (const e of r.ev) console.log("   " + e);
  console.log(`   waited-at-exit: ${r.waitedFor ?? "n/a"}`);
  console.log(`   stderr has "Waiting for the debugger to disconnect...": ${r.err.includes("Waiting for the debugger to disconnect...")}`);
  console.log(`   >>> exited=${r.exited} code=${r.code} expected=${row.expectCode}`);
}

console.log("\n================ SUMMARY ================");
let bad = 0;
for (const r of results) {
  const ok = r.exited && r.code === r.row.expectCode;
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${r.row.name.padEnd(28)} exited=${String(r.exited).padEnd(5)} code=${String(r.code).padEnd(5)} want=${r.row.expectCode}  waited=${r.waitedFor ?? "n/a"}  msg=${r.err.includes("Waiting for the debugger to disconnect...")}`);
}
console.log(bad === 0 ? "ALL ROWS EXITED AS EXPECTED" : `${bad} ROW(S) FAILED`);
process.exit(bad === 0 ? 0 : 1);
