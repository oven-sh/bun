// spawn-pipe-tax.mjs — bun AND node. User-visible spawnSync cost by stdio mode.
//
// CLAIM UNDER TEST
//   "stdio:'pipe' spawns pay a removable libuv tax over stdio:'ignore' on Windows."
//   Per piped fd, libuv builds a fresh named-pipe pair: CreateNamedPipeA with a
//   collision-retry loop + CreateFileA + blocking ConnectNamedPipe
//   (libuv src/win/pipe.c:209-346, process-stdio.c:232-255), then runs the
//   uv_pipe read lifecycle and deferred uv_close endgame. 'ignore' instead opens
//   NUL 3x per spawn (process-stdio.c:210-230). The native design
//   (the libuv-removal work.2/3.3) can pool/pre-create overlapped
//   pipe pairs and cache the NUL handle, collapsing the mode differences.
//
// MEASURED TODAY (Windows 11 dev box, bun 1.4.0, node 25.8.1, null child 4-10ms
// depending on machine state):
//   pipe2-ignore BRACKETS ZERO in both runtimes across sessions (bun −0.04 ms
//   [−0.14..+0.14], node −0.19 ms [−0.28..+0.03]; earlier sessions +0.02..0.06):
//   the libuv pipe-pair tax is real in the syscall trace but ≈0 ± 0.2 ms at
//   user-visible scale — the spawn is dominated by kernel CreateProcessW +
//   child lifetime. Treat this script as a PARITY/REGRESSION table for the
//   migration: after native spawn lands, pipe rows must equal ignore within
//   noise, and no row may regress. node runs the same libuv layer, so its
//   matching ~zero deltas corroborate the attribution.
//   The 4MiB payload row measures the uv_pipe overlapped read path: ~1.0-1.5
//   ms/MiB in BOTH runtimes when measured in the same session, and an ffi
//   CreatePipe+ReadFile control measured the same — the read path is already at
//   the kernel pipe floor. Expect NO movement; watch for regressions.
//   Only paired deltas within one run are meaningful; absolutes drift 2-3x
//   between sessions (Defender / power state).
//
// METHOD
//   Interleaved rounds across all modes (machine drift cancels in paired
//   per-round deltas), median-of-deltas, 5 repeats with spread. The shell row
//   (cmd /c exit 0) anchors how small these deltas are for real shell-heavy
//   workloads (husky, lint-staged): >=15ms/spawn, so the tax is <1%.
//
// RUN
//   bun  bench/libuv-removal/spawn-pipe-tax.mjs     (before/after native spawn)
//   node bench/libuv-removal/spawn-pipe-tax.mjs     (reference: same libuv layer)
//   Optional: SPAWN_BENCH_SHELL=0 skips the cmd.exe row; first run needs clang
//   or zig in PATH to build nullchild.exe.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const IS_BUN = typeof Bun !== "undefined";
if (process.platform !== "win32") {
  console.error("Windows-only benchmark.");
  process.exit(1);
}

const DIR = fileURLToPath(new URL(".", import.meta.url));
const CHILD = DIR + "nullchild.exe";
if (!existsSync(CHILD)) {
  let built = false;
  for (const cc of [["clang", "-O2"], ["zig", "cc", "-O2"]]) {
    const r = spawnSync(cc[0], [...cc.slice(1), DIR + "nullchild.c", "-o", CHILD], { stdio: "ignore" });
    if (r.status === 0) { built = true; break; }
  }
  if (!built) {
    console.error("could not build nullchild.exe (need clang or zig in PATH)");
    process.exit(1);
  }
}

const PAYLOAD = 4 << 20;
const now = () => Number(process.hrtime.bigint()) / 1e6;
const med = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

// Both runtimes default to windowsHide:false; we pass nothing so each runtime's
// DEFAULT user-visible path is measured (bun: js_bun_spawn_bindings.rs:404).
function spawnOnce(cmd, args, stdio) {
  if (IS_BUN) {
    const r = Bun.spawnSync({ cmd: [cmd, ...args], stdin: stdio[0], stdout: stdio[1], stderr: stdio[2] });
    if (r.exitCode !== 0) throw new Error("exit " + r.exitCode);
    return r.stdout ? r.stdout.length : 0;
  }
  const r = spawnSync(cmd, args, { stdio, maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error("exit " + r.status);
  return r.stdout ? r.stdout.length : 0;
}

const VARIANTS = {
  "ignore": () => spawnOnce(CHILD, [], ["ignore", "ignore", "ignore"]),
  "pipe2": () => spawnOnce(CHILD, [], ["ignore", "pipe", "pipe"]),
  "pipe3": () => spawnOnce(CHILD, [], ["pipe", "pipe", "pipe"]),
  "inherit": () => spawnOnce(CHILD, [], ["inherit", "inherit", "inherit"]),
  "pipe-4MiB": () => {
    const n = spawnOnce(CHILD, [String(PAYLOAD)], ["ignore", "pipe", "ignore"]);
    if (n !== PAYLOAD) throw new Error("short read " + n);
  },
};
const PAIRS = [
  ["pipe2", "ignore", "pipe-pair tax, 2 pipes (libuv pipe.c:209-346)"],
  ["pipe3", "ignore", "pipe-pair tax, 3 pipes"],
  ["inherit", "ignore", "DuplicateHandle x3 vs NUL-open x3"],
  ["pipe-4MiB", "pipe2", "4MiB stdout read via uv_pipe (divide by 4 => ms/MiB)"],
];

const ROUNDS = 25, REPEATS = 5, WARMUP = 4;
const keys = Object.keys(VARIANTS);
for (const k of keys) for (let i = 0; i < WARMUP; i++) VARIANTS[k]();

const repeatMedians = Object.fromEntries(keys.map(k => [k, []]));
const repeatDeltaMedians = PAIRS.map(() => []);
for (let rep = 0; rep < REPEATS; rep++) {
  const samples = Object.fromEntries(keys.map(k => [k, []]));
  for (let r = 0; r < ROUNDS; r++) {
    for (const k of keys) {
      const t0 = now();
      VARIANTS[k]();
      samples[k].push(now() - t0);
    }
  }
  for (const k of keys) repeatMedians[k].push(med(samples[k]));
  PAIRS.forEach(([a, b], i) => {
    repeatDeltaMedians[i].push(med(samples[a].map((v, j) => v - samples[b][j])));
  });
}

const rt = IS_BUN ? `bun ${Bun.version}` : `node ${process.versions.node}`;
console.log(`runtime: ${rt}   child: ${CHILD}`);
console.log(`rounds=${ROUNDS} repeats=${REPEATS} (interleaved; paired per-round deltas)\n`);
console.log("absolute per-spawn time (median of per-repeat medians; min..max across repeats):");
for (const k of keys) {
  const m = repeatMedians[k];
  console.log(`  ${k.padEnd(10)} ${med(m).toFixed(3)} ms   [${Math.min(...m).toFixed(3)} .. ${Math.max(...m).toFixed(3)}]`);
}
console.log("\npaired mode deltas (median-of-per-round-deltas; min..max across repeats):");
PAIRS.forEach(([a, b, label], i) => {
  const m = repeatDeltaMedians[i];
  console.log(`  ${(a + " - " + b).padEnd(20)} ${med(m) >= 0 ? "+" : ""}${med(m).toFixed(3)} ms   [${Math.min(...m).toFixed(3)} .. ${Math.max(...m).toFixed(3)}]  ${label}`);
});

// Reality anchor: a real shell child dwarfs all of the above.
if (process.env.SPAWN_BENCH_SHELL !== "0") {
  const cmdExe = process.env.COMSPEC || "C:\\Windows\\System32\\cmd.exe";
  const t = [];
  for (let i = 0; i < 2; i++) spawnOnce(cmdExe, ["/d", "/c", "exit 0"], ["ignore", "ignore", "ignore"]);
  for (let i = 0; i < 10; i++) {
    const t0 = now();
    spawnOnce(cmdExe, ["/d", "/c", "exit 0"], ["ignore", "ignore", "ignore"]);
    t.push(now() - t0);
  }
  console.log(`\nreality anchor: 'cmd /d /c exit 0' (ignore) median ${med(t).toFixed(2)} ms/spawn`);
  console.log("=> for shell-heavy workflows the mode deltas above are <1% of each spawn.");
}
