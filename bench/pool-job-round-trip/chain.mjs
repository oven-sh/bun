// One awaited pool job at a time. Prints latency percentiles and CPU time per call.
//   bun chain.mjs <op> [N=3000] [thinkUs=0] [chains=1]
// thinkUs: JS work between two awaits (busy loop). chains: how many chains run side by side.
import nodeCrypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import dnsPromises from "node:dns/promises";

const which = process.argv[2] || "nodeHkdf";
const N = +(process.argv[3] || 3000);
const thinkUs = +(process.argv[4] || 0);
const chains = +(process.argv[5] || 1);

const small = new Uint8Array(32), buf4k = new Uint8Array(4096);
const key = await crypto.subtle.importKey("raw", new Uint8Array(32), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
const k32 = Buffer.alloc(32, 1), salt = Buffer.alloc(16, 2), info = Buffer.alloc(8, 3);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chain-"));
const file4k = path.join(dir, "4k.bin");
fs.writeFileSync(file4k, Buffer.alloc(4096, 7));
const fileOut = path.join(dir, "out.bin");
process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
const pbkdf2 = iters => () => new Promise(r => nodeCrypto.pbkdf2(k32, salt, iters, 32, "sha256", r));
const ops = {
  subtleHmac: () => crypto.subtle.sign("HMAC", key, small),
  subtleDigest4096: () => crypto.subtle.digest("SHA-256", buf4k),
  nodeHkdf: () => new Promise(r => nodeCrypto.hkdf("sha256", k32, salt, info, 32, r)),
  randomBytes: () => new Promise(r => nodeCrypto.randomBytes(32, r)),
  fsStat: () => fs.promises.stat(file4k),
  fsReadFile: () => fs.promises.readFile(file4k),
  fsAccess: () => fs.promises.access(file4k),
  bunFileBytes: () => Bun.file(file4k).bytes(),
  bunFileText: () => Bun.file(file4k).text(),
  bunWrite: () => Bun.write(fileOut, buf4k),
  fsWriteFile: () => fs.promises.writeFile(fileOut, buf4k),
  dnsLookup: () => dnsPromises.lookup("127.0.0.1"),
  gzip4k: () => new Promise(r => zlib.gzip(buf4k, r)),
  scrypt_1ms: () => new Promise(r => nodeCrypto.scrypt("password", "salt", 32, { N: 1024 }, r)),
  scrypt_100us: () => new Promise(r => nodeCrypto.scrypt("password", "salt", 32, { N: 64 }, r)),
  pbkdf2_20us: pbkdf2(40),
  pbkdf2_100us: pbkdf2(200),
  pbkdf2_1ms: pbkdf2(2000),
};
const op = ops[which];
if (!op) throw new Error("unknown op " + which + "; one of " + Object.keys(ops).join(" "));

function think() {
  if (!thinkUs) return;
  const end = performance.now() + thinkUs / 1000;
  while (performance.now() < end);
}
function switches() {
  let vol = 0, invol = 0, threads = 0;
  if (process.platform !== "linux") return { vol, invol, threads };
  for (const tid of fs.readdirSync("/proc/self/task")) {
    let st;
    try { st = fs.readFileSync(`/proc/self/task/${tid}/status`, "utf8"); } catch { continue; }
    threads++;
    vol += +/^voluntary_ctxt_switches:\s+(\d+)/m.exec(st)[1];
    invol += +/^nonvoluntary_ctxt_switches:\s+(\d+)/m.exec(st)[1];
  }
  return { vol, invol, threads };
}
async function chain(n, lat) {
  for (let i = 0; i < n; i++) {
    const s = performance.now();
    await op();
    if (lat) lat[i] = performance.now() - s;
    think();
  }
}
await Promise.all(Array.from({ length: chains }, () => chain(300)));
const lat = new Float64Array(N);
const sw0 = switches(), cpu0 = process.cpuUsage(), t0 = performance.now();
await Promise.all(Array.from({ length: chains }, (_, c) => chain(N, c === 0 ? lat : null)));
const wall = performance.now() - t0, cpu = process.cpuUsage(cpu0), sw1 = switches();
lat.sort();
const q = p => +(lat[Math.min(N - 1, (N * p) | 0)] * 1000).toFixed(1);
const calls = N * chains;
console.log(JSON.stringify({
  op: which, thinkUs, chains,
  p10: q(0.1), p50: q(0.5), p90: q(0.9), p99: q(0.99),
  meanUs: +((wall * 1000) / N - thinkUs).toFixed(1),
  cpuUsPerCall: +((cpu.user + cpu.system) / calls).toFixed(1),
  switchesPerCall: +((sw1.vol + sw1.invol - sw0.vol - sw0.invol) / calls).toFixed(2),
  threads: sw1.threads,
}));
