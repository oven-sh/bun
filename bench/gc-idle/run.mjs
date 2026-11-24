// What a process costs while it waits (wake-ups, CPU time, resident memory), and how long it keeps a burst of memory.
//
//   bun bench/gc-idle/run.mjs [--seconds=12] [--rounds=5] [--input=idle|timer|burst] [--start=5100] <runtime>...
//
// The input is idle.js (one timer at the end), timer.js (a timer that allocates once a second) or burst.js (150 MB
// alive, 40 MB of garbage one second in, then at --start ms 36 MB that the program uses for 400 ms). For burst.js the
// last column is the time from the burst until anonymous memory is back within 10% of what it was before. Give it
// --seconds=18: Bun's scheduled full collection comes 10 s after the burst. A runtime is a command (bun, node) or a
// path. Variables for one runtime go in front of it, separated by commas:
//
//   bun run.mjs ./bun-before ./bun-after BUN_GC_TIMER_DISABLE=1,./bun-before node
//
// The rounds run the runtimes one after the other, so that a busy machine disturbs all of them alike. The memory columns
// are read from /proc/<pid>/smaps_rollup half a second before the end. That file walks the page tables.
// /proc/<pid>/status and the peak RSS of wait4() do not: the first reads counters that drift while many threads run,
// and the second is never below the RSS of the process that spawned the child. Where there is no /proc, the memory
// columns and the burst column stay empty, and on Windows the switches too (it reports none). For Bun the eden and
// full columns count the collections JSC ran (from BUN_JSC_logGC in one more run).
import { spawn } from "bun";
import { join } from "node:path";

const options = { seconds: 12, rounds: 5, input: "idle", start: 5100 };
const runtimes = [];
for (const arg of process.argv.slice(2)) {
  const option = arg.match(/^--(seconds|rounds|start)=(\d+)$/);
  if (option) {
    options[option[1]] = Number(option[2]);
    continue;
  }
  const input = arg.match(/^--input=(idle|timer|burst)$/);
  if (input) {
    options.input = input[1];
    continue;
  }
  // The command follows the last comma. A value can hold commas: a variable starts only where NAME= follows a comma.
  const at = arg.lastIndexOf(",");
  const env = {};
  if (at >= 0) {
    for (const pair of arg.slice(0, at).split(/,(?=[A-Za-z_][A-Za-z0-9_]*=)/)) {
      const equals = pair.indexOf("=");
      if (equals <= 0) throw new Error(`${arg}: expected NAME=value in front of the command, got "${pair}"`);
      env[pair.slice(0, equals)] = pair.slice(equals + 1);
    }
  }
  runtimes.push({ label: arg, cmd: arg.slice(at + 1), env, runs: [] });
}
if (runtimes.length === 0) {
  console.error(
    "usage: bun run.mjs [--seconds=12] [--rounds=5] [--input=idle|timer|burst] [--start=5100] <runtime>...",
  );
  process.exit(1);
}

const script = join(import.meta.dir, options.input + ".js");
const ms = String(options.seconds * 1000);
const median = values => values.sort((a, b) => a - b)[values.length >> 1];
const rounded = (values, digits) => {
  const value = median(values);
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : "";
};

const hasProc = process.platform === "linux";
if (!hasProc) console.error("No /proc on this system: the memory columns and the burst column stay empty.");
if (process.platform === "win32") console.error("Windows reports no context switches: that column stays empty.");

// NaN for a process that has exited.
async function readMemory(pid) {
  if (!hasProc) return {};
  const rollup = await Bun.file(`/proc/${pid}/smaps_rollup`)
    .text()
    .catch(() => "");
  const mb = name => Number(rollup.match(new RegExp("\\n" + name + ":\\s+(\\d+) kB"))?.[1]) / 1024;
  return { rss: mb("Rss"), anon: mb("Anonymous") };
}

// Seconds from the burst until anonymous memory, after it rose, is back within 10% of the last reading before the burst.
async function burstBack(proc, started) {
  if (!hasProc) return undefined;
  let before = NaN;
  let risen = false;
  for (;;) {
    await Bun.sleep(100);
    const elapsed = performance.now() - started;
    const { anon } = await readMemory(proc.pid);
    if (Number.isNaN(anon)) return Infinity;
    if (elapsed < options.start) before = anon;
    else if (anon > before * 1.1) risen = true;
    else if (risen) return (elapsed - options.start) / 1000;
  }
}

async function run(runtime, extraEnv = {}) {
  const started = performance.now();
  const proc = spawn({
    cmd: [runtime.cmd, script, ms, ...(options.input === "burst" ? [String(options.start)] : [])],
    env: { ...process.env, ...runtime.env, ...extraEnv },
    stdout: "ignore",
    stderr: "pipe",
  });
  const memory = Bun.sleep(options.seconds * 1000 - 500).then(() => readMemory(proc.pid));
  const back = options.input === "burst" ? burstBack(proc, started) : undefined;
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`${runtime.label}: exit code ${exitCode}\n${stderr}`);
  return { usage: proc.resourceUsage(), memory: await memory, back: await back, stderr };
}

for (let round = 0; round < options.rounds; round++) {
  for (const runtime of runtimes) runtime.runs.push(await run(runtime));
}

const rows = [];
for (const runtime of runtimes) {
  const { stderr } = await run(runtime, { BUN_JSC_logGC: "1" });
  // Only Bun writes this log.
  const collections = kind => (stderr.includes("Collection, ") ? stderr.split(`=> ${kind}Collection`).length - 1 : "");
  rows.push({
    runtime: runtime.label,
    "voluntary switches":
      process.platform === "win32" ? "" : median(runtime.runs.map(({ usage }) => usage.contextSwitches.voluntary)),
    "cpu ms": rounded(
      runtime.runs.map(({ usage }) => Number(usage.cpuTime.total) / 1000),
      1,
    ),
    "RSS MB": rounded(
      runtime.runs.map(({ memory }) => memory.rss),
      1,
    ),
    "anonymous MB": rounded(
      runtime.runs.map(({ memory }) => memory.anon),
      2,
    ),
    "eden": collections("Eden"),
    "full": collections("Full"),
  });
  if (options.input === "burst" && hasProc) {
    const back = median(runtime.runs.map(({ back }) => back));
    rows.at(-1)["burst back s"] = Number.isFinite(back) ? Number(back.toFixed(1)) : "not by exit";
  }
}
console.log(`${options.input}.js for ${options.seconds} s, median of ${options.rounds} rounds`);
console.table(rows);
