// Runs the scenarios of the jsc image, each of them several times and in several ways.
//
//   bun test/jsc_scenarios.ts [--runs 5] [--image out/jsc.img] [--host out/host-linux] [--out out/scenarios.json]
//                             [--modes direct,hosted,winmem,overlay,jitwx,hwcap0,page16] [--only name,name]
//                             [--native <jsc of the same WebKit>] [--timeout seconds] [--qemu <qemu-aarch64>]
//                             [--must-end-with 96]
//
// On macOS and on Windows the same script runs the same scenarios with the host of that
// system: bun test/jsc_scenarios.ts --modes hosted --host <host> --image <jsc.img>
//
//   direct    the image runs on Linux by itself and issues its syscalls
//   hosted    host-linux runs it: every request goes through the host table. The host kills the
//             process if code outside of the host issues a syscall (seccomp), and it forwards
//             nothing to the kernel (BUN_HOST_FORWARD is taken out of the environment)
//   winmem    hosted, with the memory model of the Windows host (BUN_HOST_TEST=winmem)
//   overlay   hosted, MADV_DONTNEED done the way the macOS branch does it (BUN_HOST_TEST=overlay)
//   jitwx     hosted, memory for code is writable or executable for a thread, never both, as
//             on Apple Silicon (BUN_HOST_TEST=jitwx). The switches are in the result
//   hwcap0    hosted, aarch64: the image is told that the processor has none of the features
//             that AT_HWCAP names (BUN_HOST_HWCAP=0,0)
//   page16    hosted, pages of 16 KiB as macOS on Apple Silicon has them (BUN_HOST_PAGE=16384)
// direct, winmem, overlay, jitwx, hwcap0 and page16 are for Linux.
//
// An image for another processor than the one of this machine (aarch64 on x86-64) runs
// under qemu, and so does its host. qemu has no filter for syscalls, so on Linux such an
// image runs as a copy in which the instructions that the way must not use are traps:
//   direct    "mov xN, x18" and "mrs xN, tpidrro_el0": the thread pointer of other systems
//   hosted    "svc", and every use of tpidr_el0 and tpidrro_el0: what is left is the host
//             table and x18, which the host checks at every request and signal (exit code 96)
//
// --must-end-with is for a negative control: a run counts when the host ended it with
// that exit code, and the result says how many runs of each scenario did.
//
// A run passes when the exit code is 0 and the output is the expected one. The counts of the
// requests and the paths that the image handed over are summed over the hosted runs of every way.
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const tree = resolve(dirname(import.meta.path), "..");
const work = resolve(tree, "..");
const option = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const runs = Number(option("runs", "5"));
const image = resolve(option("image", join(work, "out/jsc.img")));
const host = resolve(option("host", join(work, "out/host-linux")));
const outFile = resolve(option("out", join(work, "out/scenarios.json")));
const modes = option("modes", "direct,hosted").split(",");
const only = option("only", "").split(",").filter(Boolean);
const native = option("native", "/tmp/portable/jsc/out/jsc-native");
const mustEndWith = option("must-end-with", "") === "" ? undefined : Number(option("must-end-with", ""));
const scratch = join(dirname(outFile), "scenario-runs");
rmSync(scratch, { recursive: true, force: true });
mkdirSync(scratch, { recursive: true });

// The processor of the image, from its ELF header.
const header = readFileSync(image).subarray(0, 64);
const arch = header.readUInt16LE(18) === 183 ? "aarch64" : "x86_64";
const here = process.arch === "arm64" ? "aarch64" : "x86_64";
const foreign = arch !== here && process.platform === "linux";
const emulator = foreign ? [option("qemu", `/usr/bin/qemu-${arch}`)] : [];
const timeout = Number(option("timeout", foreign ? "3600" : "600")) * 1000;

// aarch64 on Linux: copies of the image with traps (udf) in place of instructions.
const TRAPS: Record<string, [number, number, number]> = {
  "no-svc": [0xffffffff, 0xd4000001, 0x00000001],
  "no-tpidr": [0xffdfffe0, 0xd51bd040, 0x00000002],
  "no-tpidrro": [0xffffffe0, 0xd53bd060, 0x00000003],
  "no-x18": [0xffffffe0, 0xaa1203e0, 0x00000004],
};
const traps: Record<string, Record<string, number>> = {};
function withTraps(name: string, rules: string[]): string {
  const data = Buffer.from(readFileSync(image));
  const counts: Record<string, number> = Object.fromEntries(rules.map(r => [r, 0]));
  const phoff = Number(data.readBigUInt64LE(32)), phentsize = data.readUInt16LE(54), phnum = data.readUInt16LE(56);
  for (let i = 0; i < phnum; i++) {
    const at = phoff + i * phentsize;
    if (data.readUInt32LE(at) !== 1 || !(data.readUInt32LE(at + 4) & 1)) continue;
    const start = Number(data.readBigUInt64LE(at + 8)), end = start + Number(data.readBigUInt64LE(at + 32));
    for (let word = start; word + 4 <= end; word += 4) {
      const value = data.readUInt32LE(word);
      for (const rule of rules) {
        const [mask, match, replacement] = TRAPS[rule];
        if ((value & mask) >>> 0 !== match) continue;
        data.writeUInt32LE(replacement, word);
        counts[rule]++;
        break;
      }
    }
  }
  const path = join(scratch, name);
  writeFileSync(path, data);
  chmodSync(path, 0o755);
  traps[name] = counts;
  return path;
}
const linuxAarch64 = arch === "aarch64" && process.platform === "linux";
const imageDirect = linuxAarch64 ? withTraps("image.linux-only.img", ["no-x18", "no-tpidrro"]) : image;
const imageHosted = linuxAarch64 ? withTraps("image.x18-only.img", ["no-svc", "no-tpidr", "no-tpidrro"]) : image;

type Check = (out: string) => string | null;
type Scenario = { name: string; args: string[]; expect: Check; sameAsNative?: boolean; env?: Record<string, string>; codes?: number[] };
const jitStress = ["--useDollarVM=1", "--jitPolicyScale=0.05", "--thresholdForOMGOptimizeAfterWarmUp=2000", "--thresholdForOMGOptimizeSoon=100"];
const exactly = (want: string) => (out: string) => (out === want ? null : `output is not the expected one`);
const scenarios: Scenario[] = [
  { name: "1-print", args: ["-e", "print(1+1)"], expect: exactly("2\n") },
  {
    name: "2-ftl",
    args: ["--useDollarVM=1", join(tree, "jsc/scenarios/ftl.js")],
    expect: exactly("ftl checksum 7a83defa 36a55c5b\nftl tier reached true, optimizing compiles of kernel true\n"),
    sameAsNative: true,
  },
  {
    name: "3-file-smoke",
    args: ["--useDollarVM=1", join(tree, "jsc/smoke/smoke.js")],
    expect: out => (/^FAIL /m.test(out) ? "a check of smoke.js failed" : out.endsWith("SMOKE 25 passed, 0 failed\n") ? null : "no line 'SMOKE 25 passed, 0 failed'"),
  },
  {
    name: "3-file-wasm-tiers",
    args: ["--useDollarVM=1", join(tree, "jsc/smoke/wasm-tiers.js")],
    expect: out => (out.includes("WASMTIERS interpreter=true bbq=true omg=true\n") && out.includes("TIMERS fired in order: a\n") ? null : "tiers or timers missing"),
  },
  { name: "4-gc", args: [join(tree, "jsc/scenarios/gc.js")], expect: exactly("gc checksum 9c9696a0 a74f27d2 live 150000\n") },
  {
    name: "5-wasm",
    args: [join(tree, "jsc/scenarios/wasm.js")],
    expect: exactly(
      "wasm sum 499500\nwasm load decaf\nwasm trap cold true:RuntimeError:Out of bounds memory access\nwasm hot dcf55010\n" +
        "wasm traps hot 200 of 200\nwasm trap last page true:RuntimeError:Out of bounds memory access ok 0\n",
    ),
  },
  {
    name: "6-agent-threads",
    args: [join(tree, "jsc/scenarios/agent.js")],
    expect: exactly("agent 0 6049995\nagent 1 7050000\nagent 2 8049993\nagent 3 9050000\nagents done 4 values 6049995,7050000,8049993,9050000\n"),
  },
  // Beyond the six of the brief: what makes JavaScriptCore send a signal to a thread.
  {
    name: "7-sampling-profiler",
    args: ["--useDollarVM=1", join(tree, "jsc/scenarios/profiler.js")],
    expect: exactly("profiler samples true, checksum 76add180\n"),
  },
  {
    name: "8-watchdog",
    args: ["--watchdog=300", "--watchdog-exception-ok", join(tree, "jsc/scenarios/watchdog.js")],
    expect: exactly("watchdog loop started\n"),
    codes: [0, 3],
  },
  // The options of JavaScriptCore that take signals out of the picture, set through the environment.
  {
    name: "9-polling-traps",
    args: ["--watchdog=300", "--watchdog-exception-ok", join(tree, "jsc/scenarios/watchdog.js")],
    expect: exactly("watchdog loop started\n"),
    codes: [0, 3],
    env: { JSC_usePollingTraps: "1" },
  },
  {
    name: "10-wasm-bounds-checks",
    args: [join(tree, "jsc/scenarios/wasm.js")],
    expect: exactly(
      "wasm sum 499500\nwasm load decaf\nwasm trap cold true:RuntimeError:Out of bounds memory access\nwasm hot dcf55010\n" +
        "wasm traps hot 200 of 200\nwasm trap last page true:RuntimeError:Out of bounds memory access ok 0\n",
    ),
    env: { JSC_useWasmFaultSignalHandler: "0" },
  },
  // The JIT compiles a lot, in every tier, and needs many registers at once: see the file.
  {
    name: "11-jit-stress",
    args: [...jitStress, join(tree, "jsc/scenarios/jitstress.js")],
    expect: exactly(
      "jitstress js functions 40 checksum b1b65528\njitstress js seen in baseline 40 dfg 40 ftl 40\n" +
        "jitstress wasm functions 22 checksum 34e285b8\njitstress wasm seen in bbq 22 omg 22\n",
    ),
  },
].filter(s => (only.length ? only.some(o => s.name.includes(o)) : true) && (s.args.every(a => !a.endsWith(".js") || existsSync(a))));

type Tally = { runs: number; passes: number; failures: string[]; seconds: number[]; ended_by_the_host?: number };
const sums = { request: new Map<string, number>(), refused: new Map<string, number>(), forwarded: new Map<string, number>(), detail: new Map<string, number>() };
const perScenario = new Map<string, Map<string, number>>();
const detailsPerScenario = new Map<string, Map<string, number>>();
const paths = new Map<string, number>();
const add = (map: Map<string, number>, key: string, n: number) => map.set(key, (map.get(key) ?? 0) + n);

let endedByHost = 0;
async function once(s: Scenario, mode: string, index: number): Promise<string | null> {
  const tag = `${s.name}.${mode}.${index}`;
  const counts = join(scratch, `${tag}.counts`);
  const pathLog = join(scratch, `${tag}.paths`);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("BUN_HOST_")) env[k] = v;
  Object.assign(env, s.env ?? {});
  let cmd = [...emulator, imageDirect, ...s.args];
  const expect = s.expect;
  if (mode === "native") cmd = [native, ...s.args];
  else if (mode !== "direct") {
    cmd = [...emulator, host, imageHosted, ...s.args];
    env.BUN_HOST_COUNTS = counts;
    env.BUN_HOST_PATHS = pathLog;
    if (mode === "hwcap0") env.BUN_HOST_HWCAP = "0,0";
    else if (mode === "page16") env.BUN_HOST_PAGE = "16384";
    else if (mode !== "hosted") env.BUN_HOST_TEST = mode;
  }
  const proc = Bun.spawn(cmd, { env, stdin: "ignore", stdout: "pipe", stderr: "pipe", cwd: scratch });
  let late = false;
  const timer = setTimeout(() => {
    late = true;
    proc.kill(9);
  }, timeout);
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  clearTimeout(timer);
  writeFileSync(join(scratch, `${tag}.out`), stdout + (stderr ? `--- stderr\n${stderr}` : ""));
  if (mustEndWith !== undefined && mode !== "direct" && mode !== "native" && code === mustEndWith) {
    endedByHost++;
    return `${tag}: the host ended the run with exit code ${code}: ${stderr.trim().split("\n")[0]}`;
  }
  let problem = late ? `no end after ${timeout / 1000} s` : (s.codes ?? [0]).includes(code) ? expect(stdout) : `exit code ${code}${proc.signalCode ? ` (${proc.signalCode})` : ""}`;
  if (!problem && stderr.trim()) problem = `output on stderr: ${stderr.trim().split("\n")[0]}`;
  if (mode !== "direct" && mode !== "native" && existsSync(counts)) {
    for (const line of readFileSync(counts, "utf8").split("\n")) {
      const [kind, number, name, calls] = line.split(" ");
      if (!calls) continue;
      add(sums[kind as keyof typeof sums], `${number} ${name}`, Number(calls));
      if (kind === "detail") {
        if (!detailsPerScenario.has(s.name)) detailsPerScenario.set(s.name, new Map());
        add(detailsPerScenario.get(s.name)!, `${number} ${name}`, Number(calls));
      }
      if (kind === "request") {
        if (!perScenario.has(s.name)) perScenario.set(s.name, new Map());
        add(perScenario.get(s.name)!, `${number} ${name}`, Number(calls));
      }
      if (kind === "forwarded") problem = problem ?? `the host forwarded request ${number} to the kernel`;
    }
    if (existsSync(pathLog))
      for (const line of readFileSync(pathLog, "utf8").split("\n")) {
        const parts = line.split(" ");
        if (parts.length < 3) continue;
        const result = parts.pop()!;
        const request = parts.shift()!;
        add(paths, `${request} ${parts.join(" ")} ${result}`, 1);
      }
  } else if (mode !== "direct" && mode !== "native" && !problem) problem = "the host wrote no counts";
  return problem ? `${tag}: ${problem}` : null;
}

const results: Record<string, unknown>[] = [];
for (const s of scenarios) {
  const row: Record<string, unknown> = { name: s.name, args: s.args.map(a => a.replace(tree + "/", "")) };
  const wanted = s.sameAsNative && existsSync(native) && !foreign ? [...modes, "native"] : modes;
  for (const mode of wanted) {
    const tally: Tally = { runs: 0, passes: 0, failures: [], seconds: [] };
    for (let i = 1; i <= (mode === "native" ? 1 : runs); i++) {
      const started = Date.now();
      endedByHost = 0;
      const problem = await once(s, mode, i);
      tally.seconds.push(Math.round((Date.now() - started) / 100) / 10);
      tally.runs++;
      if (mustEndWith !== undefined) tally.ended_by_the_host = (tally.ended_by_the_host ?? 0) + endedByHost;
      if (problem) tally.failures.push(problem);
      else tally.passes++;
    }
    row[mode] = tally;
    const control = mustEndWith === undefined ? "" : `, ${tally.ended_by_the_host} ended by the host with ${mustEndWith}`;
    console.log(`${s.name.padEnd(20)} ${mode.padEnd(8)} ${tally.passes} of ${tally.runs}${control}   ${tally.seconds.join(" ")} s${tally.failures.length ? "   " + tally.failures[0] : ""}`);
  }
  results.push(row);
}

const table = (map: Map<string, number>) =>
  [...map.entries()]
    .map(([key, calls]) => ({ number: Number(key.split(" ")[0]), name: key.split(" ")[1], calls }))
    .sort((a, b) => a.number - b.number);
const report = {
  image,
  arch,
  emulator: emulator[0] ?? null,
  traps_in_the_copies_that_ran: traps,
  host,
  runs,
  modes,
  must_end_with: mustEndWith ?? null,
  scenarios: results,
  requests: table(sums.request).map(r => ({ ...r, by_scenario: Object.fromEntries([...perScenario.entries()].map(([s, m]) => [s, m.get(`${r.number} ${r.name}`) ?? 0]).filter(([, n]) => n)) })),
  refused: table(sums.refused),
  forwarded: table(sums.forwarded),
  details: Object.fromEntries([...sums.detail.entries()].sort()),
  details_by_scenario: Object.fromEntries([...detailsPerScenario.entries()].map(([name, m]) => [name, Object.fromEntries([...m.entries()].sort())])),
  paths: [...paths.entries()]
    .map(([key, count]) => {
      const parts = key.split(" ");
      const result = Number(parts.pop());
      const request = parts.shift();
      return { path: parts.join(" "), request, result, count };
    })
    .sort((a, b) => a.path.localeCompare(b.path)),
};
writeFileSync(outFile, JSON.stringify(report, null, 1) + "\n");
console.log(`requests: ${report.requests.length} numbers, refused: ${report.refused.length}, forwarded: ${report.forwarded.length}. Written: ${outFile}`);
const tallies = results.flatMap(r => Object.values(r).filter(v => typeof v === "object" && v !== null && "failures" in v) as Tally[]);
if (mustEndWith !== undefined) {
  // A negative control: it did its work when the host ended at least one run, and when
  // the image is not broken in another way: by itself it passes.
  const ended = tallies.reduce((n, t) => n + (t.ended_by_the_host ?? 0), 0);
  const direct = results.map(r => r.direct as Tally | undefined).filter(Boolean) as Tally[];
  const directFailed = direct.reduce((n, t) => n + t.failures.length, 0);
  console.log(`negative control: the host ended ${ended} of ${tallies.reduce((n, t) => n + t.runs, 0) - direct.reduce((n, t) => n + t.runs, 0)} hosted runs with exit code ${mustEndWith}, ${directFailed} direct runs failed`);
  process.exit(ended && !directFailed ? 0 : 1);
}
process.exit(tallies.some(t => t.failures.length) ? 1 : 0);
