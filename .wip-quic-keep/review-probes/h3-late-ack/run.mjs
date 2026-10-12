// Late-ACK probe for HTTP/3 (fetch protocol:"http3" -> UDP relay -> Bun.serve http3).
//
// usage: bun run.mjs <variant> [ageSeconds]
//   variant "ackonly": the ACK that arrives after the client's RTO has, as its
//                      largest acknowledged packet, an ACK-only packet that the
//                      RTO destroyed
//   variant "retx":    same timing, but the relay does not let the client see
//                      the server data it would ACK: the late ACK's largest
//                      acknowledged packet is a STREAM packet (control)
//   variant "early":   the ACK is not held at all (control: no RTO)
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { openSync, readSync, fstatSync } from "node:fs";
import { join } from "node:path";

const variant = process.argv[2] ?? "ackonly";
const AGE = Number(process.argv[3] ?? 10);
const R3_TIMEOUT = Number(process.env.R3_TIMEOUT ?? 12000);
const t0 = performance.now();
const now = () => Math.round(performance.now() - t0);
const log = (...a) => console.log(`[${String(now()).padStart(6)}ms]`, ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(cond, what, timeout = 15000) {
  const start = performance.now();
  while (!cond()) {
    if (performance.now() - start > timeout) throw new Error("timed out waiting for " + what);
    await sleep(1);
  }
}

// ---- origin -------------------------------------------------------------
const serverProc = Bun.spawn({
  cmd: [process.execPath, join(import.meta.dir, "server.mjs")],
  env: process.env,
  stdin: "pipe",
  stdout: "inherit",
  stderr: "pipe",
});
let serverPort = 0;
{
  const reader = serverProc.stderr.getReader();
  let buf = "";
  while (!serverPort) {
    const { value, done } = await reader.read();
    if (done) throw new Error("server exited: " + buf);
    buf += new TextDecoder().decode(value);
    const m = buf.match(/PORT=(\d+)/);
    if (m) serverPort = Number(m[1]);
  }
  reader.releaseLock();
  (async () => { for await (const _ of serverProc.stderr) {} })();
}
const tellServer = cmd => { serverProc.stdin.write(cmd + "\n"); serverProc.stdin.flush(); };

// ---- relay --------------------------------------------------------------
const front = createSocket("udp4");
const upstream = createSocket("udp4");
front.bind(0, "127.0.0.1");
upstream.bind(0, "127.0.0.1");
await Promise.all([once(front, "listening"), once(upstream, "listening")]);
const relayPort = front.address().port;
let clientPort = 0;
const policy = { c2s: "pass", s2c: "pass" }; // pass | queue | drop
const c2sQ = [];
const s2cQ = [];
const trace = []; // [ms, dir, len, action]
let lastPacketAt = performance.now();
const toServer = p => upstream.send(p, serverPort, "127.0.0.1");
const toClient = p => front.send(p, clientPort, "127.0.0.1");
front.on("message", (p, from) => {
  clientPort = from.port;
  lastPacketAt = performance.now();
  trace.push([now(), "c>s", p.length, policy.c2s]);
  if (policy.c2s === "pass") toServer(p);
  else if (policy.c2s === "queue") c2sQ.push({ p, at: now() });
});
upstream.on("message", p => {
  lastPacketAt = performance.now();
  trace.push([now(), "s>c", p.length, policy.s2c]);
  if (policy.s2c === "pass") toClient(p);
  else if (policy.s2c === "queue") s2cQ.push({ p, at: now() });
});
const quiet = async (ms, cap = 40000) => { const s0 = performance.now(); while (performance.now() - lastPacketAt < ms) { if (performance.now() - s0 > cap) { log('never quiet for', ms, 'ms; last packets:', JSON.stringify(trace.slice(-8))); return false; } await sleep(5); } return true; };
const isSmall = p => !(p[0] & 0x80) && p.length <= 60;

// ---- the client's lsquic log (LD_PRELOAD helper writes it per pid) -------
const logPath = join(process.env.LSQ_LOG_DIR, `lsq.${process.pid}.log`);
let logFd = -1;
let logOff = 0;
let logTail = "";
function newLogLines() {
  if (logFd < 0) { try { logFd = openSync(logPath, "r"); } catch { return []; } }
  const size = fstatSync(logFd).size;
  if (size <= logOff) return [];
  const buf = Buffer.alloc(size - logOff);
  readSync(logFd, buf, 0, buf.length, logOff);
  logOff = size;
  const text = logTail + buf.toString("latin1");
  const lines = text.split("\n");
  logTail = lines.pop();
  return lines;
}
const seen = { rto: 0, gate: 0, clearRtos: 0, clearAlarm: 0, setAlarm: 0 };
function scanLog(print = false) {
  for (const line of newLogLines()) {
    if (!line.includes("sendctl:") && !line.includes("alarmset:")) continue;
    let hit = null;
    if (line.includes("RETX_APP timeout, mode RETX_MODE_RTO")) { seen.rto++; hit = "RTO"; }
    else if (line.includes("RETX_APP timeout, mode RETX_MODE_TLP")) hit = "TLP";
    else if (line.includes("sc_next_limit is 0")) { seen.gate++; hit = "GATE"; }
    else if (line.includes("clear sc_n_consec_rtos")) { seen.clearRtos++; hit = "RESET"; }
    else if (line.includes("No retransmittable packets: clear alarm")) { seen.clearAlarm++; hit = "CLEAR-ALARM"; }
    else if (line.includes("set RETX_APP pns alarm")) { seen.setAlarm++; hit = "SET-ALARM"; }
    else if (line.includes("Got ACK frame")) hit = "ACK";
    else if (line.includes("lost unretransmittable") || line.includes("lost retransmittable")) hit = "LOST";
    else if (line.includes("acking via") || line.includes("loss chain")) hit = "ACKED";
    else if (line.includes("sent packet")) hit = "SENT";
    else if (line.includes("reset RTO counter")) hit = "TIME-RESET";
    if (hit && print) console.log("      client-lsquic:", line.replace(/^\S+ \[\w+\] \[QUIC:\w+\] /, "").slice(0, 150));
  }
}

// ---- client -------------------------------------------------------------
const fetchH3 = (path, init = {}) =>
  fetch(`https://127.0.0.1:${relayPort}${path}`, { ...init, protocol: "http3", tls: { rejectUnauthorized: false } });

log(`variant=${variant} server=${serverPort} relay=${relayPort} age=${AGE}s bin=${process.execPath}`);
for (let i = 0; i < 2; i++) await (await fetchH3("/hello")).text();
for (let i = 0; i < AGE; i++) { await sleep(1000); await (await fetchH3("/hello")).text(); }
log("warm-up and ageing done; client->server packets so far:", trace.filter(t => t[1] === "c>s").length);

// R1: a streamed response that stays open.
const r1 = await fetchH3("/stream");
const r1reader = r1.body.getReader();
const first = await r1reader.read();
log("R1 first chunk:", first.value?.length);
await quiet(2500);
scanLog();
log("2.5 s with no packet in either direction; lsquic log so far:", JSON.stringify(seen));
const before = { ...seen };

if (variant === "early") {
  tellServer("release");
  const r2 = await fetchH3("/echo", { method: "POST", body: Buffer.alloc(2000, 120) });
  log("R2 (not held):", await r2.text());
} else {
  // Hold both directions.  The origin finishes R1: three STREAM packets (P).
  policy.c2s = "queue";
  policy.s2c = "queue";
  if (variant === "ackonly") {
    tellServer("release");
    await until(() => s2cQ.length >= 2, "P at the relay");
    log("P is at the relay:", s2cQ.map(x => x.p.length).join(","));
  }
  // R2: two STREAM packets from the client.  Its answer is held at the origin.
  const r2p = fetchH3("/echo?hold", { method: "POST", body: Buffer.alloc(2000, 120) });
  await until(() => c2sQ.filter(x => x.p.length >= 200).length >= 2, "R2 packets at the relay");
  const tR2 = now();
  log("R2 packets are at the relay:", c2sQ.map(x => x.p.length).join(","));
  if (variant === "ackonly") {
    // The client now gets P, and answers with an ACK-only packet.
    const mark = c2sQ.length;
    for (const x of s2cQ.splice(0)) toClient(x.p);
    await until(() => c2sQ.slice(mark).some(x => isSmall(x.p)), "the client's ACK-only packet");
    await sleep(40); // a second ACK-only packet, for the rest of P
    let idx = -1;
    c2sQ.forEach((x, i) => { if (i >= mark && isSmall(x.p)) idx = i; });
    log(`the client's last ACK-only packet (${c2sQ[idx].p.length} bytes) reached the relay ${c2sQ[idx].at - tR2} ms after R2; queue:`,
      c2sQ.map(x => x.p.length).join(","));
    // The origin gets the ACK-only packet first, then what was sent before it.
    const upto = c2sQ.splice(0, idx + 1);
    toServer(upto[upto.length - 1].p);
    for (const x of upto.slice(0, -1)) toServer(x.p);
  } else {
    // retx control: the origin gets R2's two packets only.
    const upto = c2sQ.splice(0);
    for (const x of upto) toServer(x.p);
  }
  policy.c2s = "drop"; // TLP and RTO retransmissions never reach the origin
  c2sQ.length = 0;
  // Wait for the client's retransmission timeout, and for the two packets it allows.
  await until(() => (scanLog(), seen.rto > before.rto), "the client's RTO", 5000);
  const tRto = now();
  await sleep(15);
  scanLog();
  log(`client RTO ${tRto - tR2} ms after R2; held for the client:`, s2cQ.map(x => x.p.length).join(","),
    "| lsquic:", JSON.stringify(seen));
  // The late ACK.
  const mid = { ...seen };
  policy.c2s = "pass";
  policy.s2c = "pass";
  for (const x of s2cQ.splice(0)) toClient(x.p);
  tellServer("go");
  if (variant === "ackonly") tellServer("noop"); else tellServer("release");
  const r2 = await r2p;
  log(`R2 answered ${now() - tRto} ms after the RTO:`, await r2.text());
  await sleep(100);
  scanLog();
  log("after the late ACK: 'clear sc_n_consec_rtos' lines:", seen.clearRtos - mid.clearRtos,
    "| 'No retransmittable packets: clear alarm':", seen.clearAlarm - mid.clearAlarm,
    "| 'set RETX_APP alarm':", seen.setAlarm - mid.setAlarm);
}
// Drain R1.
(async () => { try { while (!(await r1reader.read()).done); } catch {} })();

await quiet(1500);
scanLog();
const lastTrace = trace.length;
const gateBefore = seen.gate;
log("1.5 s with no packet in either direction. R3 starts.");
const tR3 = now();
let outcome;
try {
  const r3 = await fetchH3("/hello", { signal: AbortSignal.timeout(R3_TIMEOUT) });
  outcome = `completed: ${await r3.text()}`;
} catch (e) {
  outcome = `failed: ${e?.name}: ${e?.message}`;
}
const dur = now() - tR3;
scanLog();
const during = trace.slice(lastTrace);
log(`R3 ${outcome} after ${dur} ms`);
log("packets at the relay during R3:", JSON.stringify(during.slice(0, 12)));
const firstC2S = during.find(t => t[1] === "c>s");
log("first client->server packet of R3 reached the relay after", firstC2S ? firstC2S[0] - tR3 : "never", "ms");
log("gate returns ('sc_next_limit is 0') in the client during R3:", seen.gate - gateBefore, "| totals:", JSON.stringify(seen));
console.log("RESULT " + JSON.stringify({ variant, bin: process.execPath, r3: outcome, r3ms: dur,
  firstR3PacketMs: firstC2S ? firstC2S[0] - tR3 : null, gateReturnsDuringR3: seen.gate - gateBefore, rto: seen.rto }));
serverProc.stdin.end();
await Promise.race([serverProc.exited, sleep(2000)]);
serverProc.kill();
front.close();
upstream.close();
process.exit(0);
