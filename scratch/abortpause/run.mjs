// Driver for the ABORT × AutoPause matrix.
// Runs every (shape × path) cell under each runtime, collects JSON results,
// and prints a grid + JSONL log.
//
// Usage: bun run.mjs [--rt canary,asan,node] [--shape fast-cl,...] [--path <glob>]

import { spawnSync, spawn } from "node:child_process";
import { once } from "node:events";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const CELL = path.join(HERE, "cell.mjs");

const RUNTIMES = {
  canary: { bin: process.env.BUN_CANARY ?? "bun", args: [] },
  asan:   { bin: process.env.BUN_ASAN ?? path.join(HERE, "../../build/debug/bun-debug"),
            args: [], env: { BUN_DEBUG_QUIET_LOGS: "1", BUN_GARBAGE_COLLECTOR_LEVEL: "1" } },
  node:   { bin: process.env.NODE_BIN ?? "node", args: ["--expose-gc"] },
};

const SHAPES = ["fast-cl", "slow-trickle", "chunked", "mid-close"];

// Discover path IDs from cell.mjs itself.
const listOut = spawnSync(RUNTIMES.node.bin, [CELL, "x", "--list"], { encoding: "utf8" });
const PATH_IDS = JSON.parse(listOut.stdout.trim());

// arg parsing
const args = Object.fromEntries(
  process.argv.slice(2).filter(a => a.startsWith("--")).map(a => {
    const [k, v] = a.slice(2).split("=");
    return [k, v ?? true];
  })
);
const rtFilter = args.rt ? String(args.rt).split(",") : Object.keys(RUNTIMES);
const shapeFilter = args.shape ? String(args.shape).split(",") : SHAPES;
const pathFilter = args.path
  ? PATH_IDS.filter(p => String(args.path).split(",").some(g => p.includes(g)))
  : PATH_IDS;
const conc = Number(args.j ?? 6);

console.error(`[run] ${pathFilter.length} paths × ${shapeFilter.length} shapes × ${rtFilter.length} runtimes = ${pathFilter.length * shapeFilter.length * rtFilter.length} cells (j=${conc})`);

// Version banner
for (const name of rtFilter) {
  const r = RUNTIMES[name];
  const v = spawnSync(r.bin, ["--version"], { encoding: "utf8" }).stdout.trim();
  let rev = "";
  if (name !== "node") rev = spawnSync(r.bin, ["--revision"], { encoding: "utf8" }).stdout.trim();
  console.error(`[run] ${name.padEnd(7)} = ${r.bin} (${v}${rev ? " " + rev : ""})`);
}

// Build the work list.
const cells = [];
for (const rtName of rtFilter)
  for (const shape of shapeFilter)
    for (const pid of pathFilter)
      cells.push({ rtName, shape, pid });

const results = [];

async function runCell({ rtName, shape, pid }) {
  const r = RUNTIMES[rtName];
  const child = spawn(r.bin, [...r.args, CELL, shape, pid], {
    env: { ...process.env, ...(r.env ?? {}), BUN_FEATURE_FLAG_DISABLE_FETCH_BACKPRESSURE: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "", err = "";
  child.stdout.on("data", d => (out += d));
  child.stderr.on("data", d => (err += d));
  const timer = setTimeout(() => child.kill("SIGKILL"), rtName === "asan" ? 15000 : 8000);
  const [code, sig] = await once(child, "exit");
  clearTimeout(timer);

  let parsed;
  try { parsed = JSON.parse(out.trim().split("\n").pop()); }
  catch { parsed = { shape, path: pid, rt: rtName, err: "no-json", raw: out.slice(0, 200) }; }
  parsed.exitCode = code;
  parsed.signal = sig;
  parsed.rtName = rtName;
  // ASAN / panic detection on stderr
  if (/AddressSanitizer|heap-use-after-free|panic|SEGV|Aborted/i.test(err)) {
    parsed.fault = err.split("\n").find(l => /AddressSanitizer|panic|SEGV|heap-use-after-free/i.test(l)) ?? "fault";
    parsed.stderr = err.slice(0, 2000);
  }
  return parsed;
}

// Bounded-concurrency runner.
let idx = 0;
async function worker() {
  while (idx < cells.length) {
    const i = idx++;
    const cell = cells[i];
    const res = await runCell(cell);
    results.push(res);
    const mark = res.skip ? "skip" : res.fault ? "FAULT" : (res.settled && res.originClosed) ? "ok" : "FAIL";
    process.stderr.write(`  [${String(i + 1).padStart(3)}/${cells.length}] ${cell.rtName.padEnd(6)} ${cell.shape.padEnd(12)} ${cell.pid.padEnd(24)} ${mark}\n`);
  }
}
await Promise.all(Array.from({ length: conc }, worker));

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
mkdirSync(path.join(HERE, "out"), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const jsonl = path.join(HERE, "out", `results-${stamp}.jsonl`);
writeFileSync(jsonl, results.map(r => JSON.stringify(r)).join("\n") + "\n");

function verdict(r) {
  if (r.skip) return "·";
  if (r.fault) return "💥";
  if (r.exitCode === null) return "⏱";
  if (r.settled && r.originClosed) return "✓";
  if (r.settled && !r.originClosed) return "s"; // settled but conn leaked
  if (!r.settled && r.originClosed) return "c"; // conn closed but op hung
  return "✗";
}

// Grid: rows = path, cols = rt×shape
console.log("");
const colKeys = [];
for (const rtName of rtFilter) for (const shape of shapeFilter) colKeys.push([rtName, shape]);
const hdr1 = "path".padEnd(26) + colKeys.map(([rt]) => rt.slice(0, 4).padEnd(5)).join("");
const hdr2 = "".padEnd(26) + colKeys.map(([, sh]) => sh.slice(0, 4).padEnd(5)).join("");
console.log(hdr1);
console.log(hdr2);
console.log("-".repeat(hdr1.length));
for (const pid of pathFilter) {
  let row = pid.padEnd(26);
  for (const [rtName, shape] of colKeys) {
    const r = results.find(x => x.rtName === rtName && x.shape === shape && x.path === pid);
    row += (r ? verdict(r) : "?").padEnd(5);
  }
  console.log(row);
}
console.log("");
console.log(`legend: ✓ pass · skip ✗ both-fail s settle-only c close-only ⏱ timeout 💥 fault`);

// Summary per runtime
for (const rtName of rtFilter) {
  const rs = results.filter(r => r.rtName === rtName && !r.skip);
  const pass = rs.filter(r => r.settled && r.originClosed && !r.fault).length;
  const faults = rs.filter(r => r.fault).length;
  const hung = rs.filter(r => r.exitCode === null).length;
  console.log(`${rtName.padEnd(7)}: ${pass}/${rs.length} pass, ${faults} faults, ${hung} timeouts`);
}

// Failure detail
const fails = results.filter(r => !r.skip && !(r.settled && r.originClosed));
if (fails.length) {
  console.log(`\n--- ${fails.length} FAILURES ---`);
  for (const f of fails) {
    console.log(`${f.rtName}/${f.shape}/${f.path}: settled=${f.settled}(${f.settledMs}ms) closed=${f.originClosed}(${f.closedMs}ms) bp=${f.backpressured} fd+${f.fdDelta} exit=${f.exitCode}${f.signal ? "/" + f.signal : ""}${f.fault ? " FAULT: " + f.fault : ""}${f.err ? " err=" + f.err : ""}`);
  }
}
console.log(`\nfull results: ${jsonl}`);
