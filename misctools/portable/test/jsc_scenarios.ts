/**
 * Runs the scenarios of the jsc image, each of them several times and in several ways.
 *
 *   bun test/jsc_scenarios.ts [--runs 5] [--image <jsc.img>] [--host <host>] [--out <scenarios.json>]
 *                             [--modes direct,hosted,winmem,overlay] [--only name,name]
 *                             [--native <jsc of the same WebKit, built for this machine>]
 *
 * Without --image it is jsc.img in the output directory of build.ts for this machine (build/portable/<arch>
 * in the repository), without --host the host next to the image, without --out scenarios.json next to the
 * image.
 *
 * On macOS and on Windows the same script runs the same scenarios with the host of that
 * system: bun test/jsc_scenarios.ts --modes hosted --host <host> --image <jsc.img>
 *
 *   direct    the image runs on Linux by itself and issues its syscalls
 *   hosted    the host runs it: every request goes through the host table. The host kills the
 *             process if code outside of the host issues a syscall (seccomp), and it forwards
 *             nothing to the kernel (BUN_HOST_FORWARD is taken out of the environment)
 *   winmem    hosted, with the memory model of the Windows host (BUN_HOST_TEST=winmem)
 *   overlay   hosted, MADV_DONTNEED done the way the macOS branch does it (BUN_HOST_TEST=overlay)
 * direct, winmem and overlay are for Linux.
 *
 * A run passes when the exit code is 0 and the output is the expected one. The counts of the
 * requests and the paths that the image handed over are summed over the hosted runs of every way.
 * With --native the scenario that computes in the optimizing compiler runs once with that program too.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { REPOSITORY, TREE, hostArch } from "../flags.ts";

const tree = TREE;
const option = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};
const runs = Number(option("runs", "5"));
const image = resolve(option("image", join(REPOSITORY, "build", "portable", hostArch(), "jsc.img")));
const hostProgram =
  process.platform === "win32" ? "host.exe" : process.platform === "darwin" ? "host-macos" : "host-linux";
const host = resolve(option("host", join(dirname(image), hostProgram)));
const outFile = resolve(option("out", join(dirname(image), "scenarios.json")));
const modes = option("modes", "direct,hosted").split(",");
const only = option("only", "").split(",").filter(Boolean);
const native = option("native", "");
const scratch = join(dirname(outFile), "scenario-runs");
rmSync(scratch, { recursive: true, force: true });
mkdirSync(scratch, { recursive: true });

type Check = (out: string) => string | null;
type Scenario = {
  name: string;
  args: string[];
  expect: Check;
  sameAsNative?: boolean;
  env?: Record<string, string>;
  codes?: number[];
};
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
    expect: (out: string) =>
      /^FAIL /m.test(out)
        ? "a check of smoke.js failed"
        : out.endsWith("SMOKE 25 passed, 0 failed\n")
          ? null
          : "no line 'SMOKE 25 passed, 0 failed'",
  },
  {
    name: "3-file-wasm-tiers",
    args: ["--useDollarVM=1", join(tree, "jsc/smoke/wasm-tiers.js")],
    expect: (out: string) =>
      out.includes("WASMTIERS interpreter=true bbq=true omg=true\n") && out.includes("TIMERS fired in order: a\n")
        ? null
        : "tiers or timers missing",
  },
  {
    name: "4-gc",
    args: [join(tree, "jsc/scenarios/gc.js")],
    expect: exactly("gc checksum 9c9696a0 a74f27d2 live 150000\n"),
  },
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
    expect: exactly(
      "agent 0 6049995\nagent 1 7050000\nagent 2 8049993\nagent 3 9050000\nagents done 4 values 6049995,7050000,8049993,9050000\n",
    ),
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
].filter(
  s =>
    (only.length ? only.some(o => s.name.includes(o)) : true) && s.args.every(a => !a.endsWith(".js") || existsSync(a)),
);

type Tally = { runs: number; passes: number; failures: string[] };
const sums = {
  request: new Map<string, number>(),
  refused: new Map<string, number>(),
  forwarded: new Map<string, number>(),
  detail: new Map<string, number>(),
};
const perScenario = new Map<string, Map<string, number>>();
const detailsPerScenario = new Map<string, Map<string, number>>();
const paths = new Map<string, number>();
const add = (map: Map<string, number>, key: string, n: number) => map.set(key, (map.get(key) ?? 0) + n);

async function once(s: Scenario, mode: string, index: number): Promise<string | null> {
  const tag = `${s.name}.${mode}.${index}`;
  const counts = join(scratch, `${tag}.counts`);
  const pathLog = join(scratch, `${tag}.paths`);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("BUN_HOST_")) env[k] = v;
  Object.assign(env, s.env ?? {});
  let cmd = [image, ...s.args];
  const expect = s.expect;
  if (mode === "native") cmd = [native, ...s.args];
  else if (mode !== "direct") {
    cmd = [host, image, ...s.args];
    env.BUN_HOST_COUNTS = counts;
    env.BUN_HOST_PATHS = pathLog;
    if (mode !== "hosted") env.BUN_HOST_TEST = mode;
  }
  const proc = Bun.spawn(cmd, { env, stdin: "ignore", stdout: "pipe", stderr: "pipe", cwd: scratch });
  const timer = setTimeout(() => proc.kill(9), 600_000);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  writeFileSync(join(scratch, `${tag}.out`), stdout + (stderr ? `--- stderr\n${stderr}` : ""));
  let problem = (s.codes ?? [0]).includes(code)
    ? expect(stdout)
    : `exit code ${code}${proc.signalCode ? ` (${proc.signalCode})` : ""}`;
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
  const wanted = s.sameAsNative && native !== "" && existsSync(native) ? [...modes, "native"] : modes;
  for (const mode of wanted) {
    const tally: Tally = { runs: 0, passes: 0, failures: [] };
    for (let i = 1; i <= (mode === "native" ? 1 : runs); i++) {
      const problem = await once(s, mode, i);
      tally.runs++;
      if (problem) tally.failures.push(problem);
      else tally.passes++;
    }
    row[mode] = tally;
    console.log(
      `${s.name.padEnd(20)} ${mode.padEnd(8)} ${tally.passes} of ${tally.runs}${tally.failures.length ? "   " + tally.failures[0] : ""}`,
    );
  }
  results.push(row);
}

const table = (map: Map<string, number>) =>
  [...map.entries()]
    .map(([key, calls]) => ({ number: Number(key.split(" ")[0]), name: key.split(" ")[1], calls }))
    .sort((a, b) => a.number - b.number);
const report = {
  image,
  host,
  runs,
  modes,
  scenarios: results,
  requests: table(sums.request).map(r => ({
    ...r,
    by_scenario: Object.fromEntries(
      [...perScenario.entries()].map(([s, m]) => [s, m.get(`${r.number} ${r.name}`) ?? 0]).filter(([, n]) => n),
    ),
  })),
  refused: table(sums.refused),
  forwarded: table(sums.forwarded),
  details: Object.fromEntries([...sums.detail.entries()].sort()),
  details_by_scenario: Object.fromEntries(
    [...detailsPerScenario.entries()].map(([name, m]) => [name, Object.fromEntries([...m.entries()].sort())]),
  ),
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
console.log(
  `requests: ${report.requests.length} numbers, refused: ${report.refused.length}, forwarded: ${report.forwarded.length}. Written: ${outFile}`,
);
const failed = results.some(r =>
  Object.values(r).some(v => typeof v === "object" && v !== null && "failures" in v && (v as Tally).failures.length),
);
process.exit(failed ? 1 : 0);
