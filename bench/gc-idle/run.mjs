// What a process costs while it only waits: wake-ups (voluntary context switches), CPU time and resident memory.
//
//   bun bench/gc-idle/run.mjs [--seconds=12] [--rounds=5] <runtime>...
//
// A runtime is a command (bun, node) or a path. Variables for one runtime go in front of it, separated by commas:
//
//   bun run.mjs ./bun-before ./bun-after BUN_GC_TIMER_DISABLE=1,./bun-before node
//
// The rounds run the runtimes one after the other, so that a busy machine disturbs all of them alike. The memory columns
// are read from /proc/<pid>/smaps_rollup half a second before the end (Linux only). That file walks the page tables.
// /proc/<pid>/status and the peak RSS of wait4() do not: the first reads counters that drift while many threads run,
// and the second is never below the RSS of the process that spawned the child. For Bun the last two columns count the
// collections JSC ran (from BUN_JSC_logGC in one more run).
import { spawn } from "bun";
import { join } from "node:path";

const options = { seconds: 12, rounds: 5 };
const runtimes = [];
for (const arg of process.argv.slice(2)) {
  const option = arg.match(/^--(seconds|rounds)=(\d+)$/);
  if (option) {
    options[option[1]] = Number(option[2]);
    continue;
  }
  const parts = arg.split(",");
  const cmd = parts.pop();
  runtimes.push({ label: arg, cmd, env: Object.fromEntries(parts.map(pair => pair.split("="))), runs: [] });
}
if (runtimes.length === 0) {
  console.error("usage: bun run.mjs [--seconds=12] [--rounds=5] <runtime>...");
  process.exit(1);
}

const script = join(import.meta.dir, "idle.js");
const ms = String(options.seconds * 1000);
const median = values => values.sort((a, b) => a - b)[values.length >> 1];

async function run(runtime, extraEnv = {}) {
  const proc = spawn({
    cmd: [runtime.cmd, script, ms],
    env: { ...process.env, ...runtime.env, ...extraEnv },
    stdout: "ignore",
    stderr: "pipe",
  });
  const memory = Bun.sleep(options.seconds * 1000 - 500).then(async () => {
    const rollup = await Bun.file(`/proc/${proc.pid}/smaps_rollup`)
      .text()
      .catch(() => "");
    const mb = name => Number(rollup.match(new RegExp("\\n" + name + ":\\s+(\\d+) kB"))?.[1]) / 1024;
    return { rss: mb("Rss"), anon: mb("Anonymous") };
  });
  const [stderr] = await Promise.all([proc.stderr.text(), proc.exited]);
  return { usage: proc.resourceUsage(), memory: await memory, stderr };
}

for (let round = 0; round < options.rounds; round++) {
  for (const runtime of runtimes) runtime.runs.push(await run(runtime));
}

const rows = [];
for (const runtime of runtimes) {
  const { stderr } = await run(runtime, { BUN_JSC_logGC: "1" });
  rows.push({
    runtime: runtime.label,
    "voluntary switches": median(runtime.runs.map(({ usage }) => usage.contextSwitches.voluntary)),
    "cpu ms": Number(median(runtime.runs.map(({ usage }) => Number(usage.cpuTime.total) / 1000)).toFixed(1)),
    "RSS MB": Number(median(runtime.runs.map(({ memory }) => memory.rss)).toFixed(1)),
    "anonymous MB": Number(median(runtime.runs.map(({ memory }) => memory.anon)).toFixed(2)),
    "eden": stderr.split("=> EdenCollection").length - 1,
    "full": stderr.split("=> FullCollection").length - 1,
  });
}
console.log(`${options.seconds} s idle, median of ${options.rounds} rounds`);
console.table(rows);
