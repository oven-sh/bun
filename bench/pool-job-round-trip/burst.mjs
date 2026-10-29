// Many pool jobs in flight: Promise.all of K jobs, repeated. Prints jobs per second and CPU per job.
//   bun burst.mjs <op> [K=64] [rounds=200]
import nodeCrypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const which = process.argv[2] || "nodeHkdf";
const K = +(process.argv[3] || 64);
const rounds = +(process.argv[4] || 200);
const k32 = Buffer.alloc(32, 1), salt = Buffer.alloc(16, 2), info = Buffer.alloc(8, 3);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "burst-"));
const file4k = path.join(dir, "4k.bin");
fs.writeFileSync(file4k, Buffer.alloc(4096, 7));
process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
import zlib from "node:zlib";
const big = Buffer.alloc(256 << 10);
for (let i = 0; i < big.length; i++) big[i] = (i * 2654435761) >>> 13;
const ops = {
  // CPU-bound jobs of about a millisecond that are not PBKDF2 (see the notes on its stack-layout sensitivity).
  scrypt_1ms: () => new Promise(r => nodeCrypto.scrypt("password", "salt", 32, { N: 1024 }, r)),
  deflate_256k: () => new Promise(r => zlib.deflate(big, { level: 6 }, r)),
  nodeHkdf: () => new Promise(r => nodeCrypto.hkdf("sha256", k32, salt, info, 32, r)),
  fsStat: () => fs.promises.stat(file4k),
  fsReadFile: () => fs.promises.readFile(file4k),
  pbkdf2_100us: () => new Promise(r => nodeCrypto.pbkdf2(k32, salt, 200, 32, "sha256", r)),
  pbkdf2_1ms: () => new Promise(r => nodeCrypto.pbkdf2(k32, salt, 2000, 32, "sha256", r)),
};
const op = ops[which];
const round = () => Promise.all(Array.from({ length: K }, op));
for (let i = 0; i < 20; i++) await round();
const times = new Float64Array(rounds);
const cpu0 = process.cpuUsage(), t0 = performance.now();
for (let i = 0; i < rounds; i++) { const s = performance.now(); await round(); times[i] = performance.now() - s; }
const wall = performance.now() - t0, cpu = process.cpuUsage(cpu0);
times.sort();
console.log(JSON.stringify({
  op: which, K,
  roundP50Us: +(times[rounds >> 1] * 1000).toFixed(1),
  jobsPerSec: Math.round((K * rounds) / (wall / 1000)),
  cpuUsPerJob: +((cpu.user + cpu.system) / (K * rounds)).toFixed(2),
}));
