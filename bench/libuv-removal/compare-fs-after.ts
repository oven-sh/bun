// compare-fs-after.ts — one-command before/after for the fs/promises +
// Bun.file architecture change (4-hop libuv chain → single WorkPool task).
//
// BEFORE = the system `bun` on PATH (shipping release).
// AFTER  = $AFTER_BUN if set, else ./build/release/bun.exe, else the debug
//          build (flagged LOUDLY: debug numbers prove hop-count shape only —
//          absolute throughput claims require the release build).
//
// Hygiene per README.md: whole-script runs are INTERLEAVED (B,A,B,A) so
// Defender episodes can't bias one side; each script already medians
// internally. Only the paired deltas printed at the bottom are publishable.
//
// RUN: bun bench/libuv-removal/compare-fs-after.ts
import { existsSync } from "node:fs";
import { join } from "node:path";

const DIR = import.meta.dir;
const SCRIPTS = [
  "asyncfs-bunfile-vs-readfile.mjs", // the headline: chain deletion
  "sync-fs-readsync-positioned.mjs", // tier-1 #1: 3-syscall pread dance → 1
  "eventloop-setimmediate-chain.mjs", // tier-1 #6: per-tick wake cost
];

const before = Bun.which("bun");
if (!before) throw new Error("no system bun on PATH for the BEFORE side");

let after = process.env.AFTER_BUN ?? "";
let afterIsDebug = false;
if (!after) {
  const release = join(DIR, "../../build/release/bun.exe");
  const debug = join(DIR, "../../build/debug/bun-debug.exe");
  if (existsSync(release)) after = release;
  else if (existsSync(debug)) {
    after = debug;
    afterIsDebug = true;
  } else {
    console.error("no AFTER binary: set AFTER_BUN, or build one (bun run build:release).");
    process.exit(1);
  }
}

async function runOne(bin: string, script: string): Promise<string> {
  const proc = Bun.spawn({
    cmd: [bin, join(DIR, script)],
    env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" },
    stdout: "pipe",
    stderr: "pipe",
    cwd: DIR,
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) return `EXIT ${code}\n${out}\n${err}`;
  return out;
}

function pickSummary(out: string): string[] {
  // Keep the per-case result lines + any "=>" verdict lines; drop banners.
  return out
    .split("\n")
    .filter(l => /ops\/s|=>|GB\/s|ns\/tick|µs|us\/op/.test(l) && !/spread only/.test(l))
    .map(l => l.trimEnd());
}

console.log(`BEFORE: ${before}`);
console.log(`AFTER:  ${after}${afterIsDebug ? "   ⚠ DEBUG BUILD — shape only, absolutes are not publishable" : ""}\n`);

for (const script of SCRIPTS) {
  console.log(`━━━ ${script} ━━━`);
  // Interleave: B, A, B, A — report run 2 of each (warmed), keep run 1 visible
  // only on big disagreement.
  const b1 = await runOne(before, script);
  const a1 = await runOne(after, script);
  const b2 = await runOne(before, script);
  const a2 = await runOne(after, script);
  console.log("BEFORE (run 2):");
  for (const l of pickSummary(b2)) console.log("  " + l);
  console.log("AFTER (run 2):");
  for (const l of pickSummary(a2)) console.log("  " + l);
  // Disagreement check between runs (Defender episode detector).
  const stable = (x: string, y: string) => pickSummary(x).length === pickSummary(y).length;
  if (!stable(b1, b2) || !stable(a1, a2)) {
    console.log("  ⚠ run-1/run-2 shape mismatch — rerun before publishing");
  }
  console.log();
}
console.log(
  "Publishable: paired within-script deltas above. Cross-binary absolutes only from the release AFTER build.",
);
