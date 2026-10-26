// Compiles many programs into one executable, runs each in a Worker of the executable and in a Worker of `bun run`, and compares what they print and how they end.
// README.md beside this file says where the programs come from.
//
//   bun run-batch.ts --bun <the Bun that builds and runs> --programs <folder> --work <folder> --finds <folder> [--count 2000] [--group 500] [--batches 1] [--flags=--aot-threads=1]
//
// It takes `count` files out of `programs` for each batch and waits for more. `--batches 0` never ends. `--keep` copies the files instead.
// `--hides-function-text` is for a Bun built with --fuzzilli=on: neither run shows the text of a function, which the two spell differently.
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { extname, join } from "node:path";
import { parseArgs } from "node:util";

const { values: options } = parseArgs({
  options: {
    bun: { type: "string", default: process.execPath },
    programs: { type: "string" },
    work: { type: "string" },
    finds: { type: "string" },
    count: { type: "string", default: "2000" },
    group: { type: "string", default: "500" },
    batches: { type: "string", default: "1" },
    flags: { type: "string", default: "" },
    milliseconds: { type: "string", default: "250" },
    keep: { type: "boolean", default: false },
    "hides-function-text": { type: "boolean", default: false },
  },
});
const { bun, programs: source, work, finds } = options as Record<string, string>;
if (!source || !work || !finds) throw new Error("Expected --programs, --work and --finds");
const [count, groupSize, batches, milliseconds] = [
  options.count,
  options.group,
  options.batches,
  options.milliseconds,
].map(Number);
const hidesFunctionText = options["hides-function-text"];
const buildFlags = [
  ...options.flags.split(" ").filter(Boolean),
  ...(hidesFunctionText ? ["--no-compile-function-source"] : []),
];
const runner = "run-each-program-in-a-worker.ts";
const mark = `=== ${Math.random().toString(36).slice(2)} ended`;
const maxFindsIsolated = 8;

type Spent = { cpuSeconds: number; wallSeconds: number; peakMegabytes: number };
type Ended = { stdout: string; stderr: string; end: string };
const spent: Record<string, Spent> = {};

async function spawn(stage: string, cmd: string[], cwd: string, env: Record<string, string>, seconds: number) {
  const [stdout, stderr] = [join(cwd, `${stage}.stdout`), join(cwd, `${stage}.stderr`)];
  const started = performance.now();
  const child = Bun.spawn({
    cmd,
    cwd,
    env: { ...process.env, ...env },
    stdin: "ignore",
    stdout: Bun.file(stdout),
    stderr: Bun.file(stderr),
    timeout: seconds * 1000,
    killSignal: "SIGKILL",
  });
  const exitCode = await child.exited;
  const usage = child.resourceUsage()!;
  const total = (spent[stage] ??= { cpuSeconds: 0, wallSeconds: 0, peakMegabytes: 0 });
  total.cpuSeconds += Number(usage.cpuTime.total) / 1e6;
  total.wallSeconds += (performance.now() - started) / 1000;
  total.peakMegabytes = Math.max(total.peakMegabytes, usage.maxRSS / 2 ** 20);
  return {
    exitCode,
    signal: child.signalCode,
    stdout: readFileSync(stdout, "latin1"),
    stderr: readFileSync(stderr, "latin1"),
  };
}

/** Writes the programs, the groups that import them, and the runner. */
function layOut(folder: string, texts: string[], extension: string, inGroup: number) {
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(join(folder, "programs"), { recursive: true });
  texts.forEach((text, index) => writeFileSync(join(folder, "programs", index + extension), text, "latin1"));
  for (let first = 0; first < texts.length; first += inGroup) {
    const rows = texts
      .slice(first, first + inGroup)
      .map((_, offset) => `  () => import("./programs/${first + offset}${extension}"),\n`);
    writeFileSync(
      join(folder, `group-${first / inGroup}${extension}`),
      `const programs = [\n${rows.join("")}];\nawait programs[Number(process.env.BATCH_PROGRAM) - ${first}]();\n`,
    );
  }
  copyFileSync(join(import.meta.dir, runner), join(folder, runner));
}

/** Builds the executable. Returns the programs that the errors name, or how the compiler stopped. */
async function build(folder: string, programCount: number, extension: string, inGroup: number) {
  const groups = Array.from(
    { length: Math.ceil(programCount / inGroup) },
    (_, group) => `./group-${group}${extension}`,
  );
  const ran = await spawn(
    "build",
    [bun, "build", "--compile", "--aot", ...buildFlags, "./" + runner, ...groups, "--outfile", join(folder, "batch")],
    folder,
    {},
    60 + programCount,
  );
  if (ran.exitCode === 0 && existsSync(join(folder, "batch")))
    return { refused: new Set<number>(), stopped: undefined };
  const stopped = ran.signal || /internal compiler error|panic|Stopped in/.test(ran.stderr);
  const refused = new Set(
    Array.from(ran.stderr.matchAll(/programs[\\/](\d+)\.[a-z]+:\d+/g), match => Number(match[1])),
  );
  return {
    refused,
    stopped:
      stopped || refused.size === 0
        ? `${ran.signal ?? `exit code ${ran.exitCode}`}\n${ran.stderr.slice(-4000)}`
        : undefined,
  };
}

/** Runs the programs one after the other in one process. When the process ends early, the program it was in gets the blame and the rest run in a new process. */
async function run(
  stage: string,
  command: string[],
  folder: string,
  extension: string,
  inGroup: number,
  indexes: number[],
  limit: number,
  env: Record<string, string> = {},
) {
  const results = new Map<number, Ended>();
  let left = indexes;
  while (left.length) {
    const ran = await spawn(
      stage,
      [...command, String(inGroup), extension.slice(1), ...left.map(String)],
      folder,
      { ...env, BATCH_MARK: mark, BATCH_MILLISECONDS: String(limit) },
      30 + (left.length * limit) / 100,
    );
    const split = (text: string) => text.split(new RegExp(`\\n${mark} (\\d+) (\\S+)\\n`));
    const [stdout, stderr] = [split(ran.stdout), split(ran.stderr)];
    const ended = (Math.min(stdout.length, stderr.length) / 3) | 0;
    for (let position = 0; position < ended; position++)
      results.set(left[position], {
        stdout: stdout[3 * position],
        stderr: stderr[3 * position],
        end: stdout[3 * position + 2],
      });
    if (ended < left.length)
      results.set(left[ended], {
        stdout: stdout.at(-1)!,
        stderr: stderr.at(-1)!.slice(-4000),
        end: `the process ended: ${ran.signal ?? `exit code ${ran.exitCode}`}`,
      });
    left = left.slice(ended + 1);
  }
  return results;
}

// What a compiled program says when it does something that docs/compiler/compatibility.mdx lists, and what a program names when its output depends on such a thing or on the collector.
// The same lists as in src/runtime/cli/fuzzilli_run_comparison.rs.
const documentedMessages = [
  "read-only in a compiled executable",
  "Attempted to assign to readonly property",
  "this executable was compiled assuming",
  "Maximum call stack size exceeded",
];
const documentedNames = [
  "eval(",
  "Function(",
  ".caller",
  ".stack",
  ".message",
  "WeakRef",
  "FinalizationRegistry",
  "import.meta",
  "__filename",
  "__dirname",
  ".argv",
  ".raw",
];

/** `console.log(error)` prints lines of the source, which an executable doesn't have, a message, whose words can differ, and a stack. */
const removeDetailsOfErrors = (output: string) =>
  output
    .split("\n")
    .filter(line => !/^\s*(\d+ \| |[\^~ ]+$|at )/.test(line))
    .map(line => line.replace(/Error: .*/, "Error").replace(/\[Function: [^\]]*\]/g, "[Function]"))
    .join("\n");
const agree = (a: Ended, b: Ended) =>
  a.end === b.end && removeDetailsOfErrors(a.stdout) === removeDetailsOfErrors(b.stdout);
const isLimit = ({ end }: Ended) => end === "time" || end === "memory";

function keepFind(kind: string, summary: string, files: Record<string, string>) {
  const group = `${kind}-${Bun.hash
    .crc32(summary.replace(/[0-9a-f]/gi, ""))
    .toString(16)
    .padStart(8, "0")}`;
  const name = `${group}/${Math.floor(Math.log2(Math.max(1, Object.values(files)[0].length)))}`;
  if (existsSync(join(finds, name))) return;
  mkdirSync(join(finds, name), { recursive: true });
  for (const [file, text] of Object.entries(files))
    writeFileSync(join(finds, name, file), file.startsWith("program") ? text : text.slice(0, 64 << 10), "latin1");
  appendFileSync(join(finds, "index.txt"), name + "\n");
}

const firstDifference = (a: string, b: string) => {
  const [left, right] = [removeDetailsOfErrors(a).split("\n"), removeDetailsOfErrors(b).split("\n")];
  const line = left.findIndex((text, index) => text !== right[index]);
  return `compiled: ${(left[line] ?? "").slice(0, 400)}\nbun run:  ${(right[line] ?? "").slice(0, 400)}\n`;
};

/** Both ways over `texts`, in a folder of their own. Returns whether program `index` still differs. */
async function differsAmong(
  folder: string,
  texts: string[],
  extension: string,
  index: number,
): Promise<boolean | undefined> {
  layOut(folder, texts, extension, texts.length);
  if (
    (await build(folder, texts.length, extension, texts.length)).stopped !== undefined ||
    !existsSync(join(folder, "batch"))
  )
    return undefined;
  const compiled = (
    await run("compiled", [join(folder, "batch")], folder, extension, texts.length, [index], milliseconds * 20)
  ).get(index)!;
  const plain = (
    await run(
      "plain",
      [bun, "run", "./" + runner],
      folder,
      extension,
      texts.length,
      [index],
      milliseconds * 20,
      plainEnv,
    )
  ).get(index)!;
  return !agree(compiled, plain);
}
const plainEnv: Record<string, string> = hidesFunctionText ? { BUN_FUZZILLI_HIDES_FUNCTION_TEXT: "1" } : {};

/** Waits until it has `count` programs. A rename decides which of several processes gets a file. */
async function takePrograms(): Promise<string[]> {
  const claimed = join(work, `claimed-${process.pid}`);
  rmSync(claimed, { recursive: true, force: true });
  mkdirSync(claimed, { recursive: true });
  const paths: string[] = [];
  for (;;) {
    for (const name of readdirSync(source).filter(name => /\.[cm]?[jt]s$/.test(name))) {
      if (paths.length === count) return paths;
      try {
        if (options.keep) copyFileSync(join(source, name), join(claimed, name));
        else renameSync(join(source, name), join(claimed, name));
        paths.push(join(claimed, name));
      } catch {}
    }
    if (options.keep && paths.length) return paths;
    await Bun.sleep(100);
  }
}

for (let batch = 0; batches === 0 || batch < batches; batch++) {
  for (const stage in spent) delete spent[stage];
  const started = performance.now();
  const paths = await takePrograms();
  const extension = extname(paths[0]);
  let texts = paths.map(path => readFileSync(path, "latin1"));
  for (const path of paths) rmSync(path, { force: true });
  const folder = join(work, `batch-${process.pid}`);
  const counts: Record<string, number> = { taken: texts.length };
  const add = (kind: string, by = 1) => (counts[kind] = (counts[kind] ?? 0) + by);

  // The programs that the compiler refuses leave, and the rest is built again.
  for (let round = 0; ; round++) {
    layOut(folder, texts, extension, groupSize);
    const { refused, stopped } = await build(folder, texts.length, extension, groupSize);
    if (stopped !== undefined) {
      keepFind("build-stopped", stopped.slice(0, 300), {
        "programs.txt": texts.map((text, index) => `// ---- ${index}\n${text}`).join("\n"),
        "compiler.stderr": stopped,
      });
      add("in a build that stopped", texts.length);
      texts = [];
    }
    if (refused.size === 0 || stopped !== undefined) break;
    add("refused", refused.size);
    texts = texts.filter((_, index) => !refused.has(index));
  }
  const all = texts.map((_, index) => index);
  const runCompiled = (indexes: number[], limit: number) =>
    run("compiled", [join(folder, "batch")], folder, extension, groupSize, indexes, limit);
  const runPlain = (indexes: number[], limit: number) =>
    run("plain", [bun, "run", "./" + runner], folder, extension, groupSize, indexes, limit, plainEnv);
  const [compiled, plain] = [await runCompiled(all, milliseconds), await runPlain(all, milliseconds)];
  const differing = all.filter(index => !agree(compiled.get(index)!, plain.get(index)!));
  add("same", all.length - differing.length);

  // A difference counts when a second pair of runs, with more time, shows it again.
  const [compiledAgain, plainAgain] = [
    await runCompiled(differing, milliseconds * 20),
    await runPlain(differing, milliseconds * 20),
  ];
  let isolated = 0;
  for (const index of differing) {
    const [first, second, reference, referenceAgain] = [
      compiled.get(index)!,
      compiledAgain.get(index)!,
      plain.get(index)!,
      plainAgain.get(index)!,
    ];
    const says = (message: string) => second.stderr.includes(message) || second.stdout.includes(message);
    const showsFunctionText = !hidesFunctionText && /function|=>|class /.test(referenceAgain.stdout + second.stdout);
    const kind = referenceAgain.end.startsWith("the process ended")
      ? "bun-run-signal"
      : isLimit(referenceAgain)
        ? "neither finished"
        : !isLimit(reference) && !agree(reference, referenceAgain)
          ? "bun run is unsteady"
          : agree(second, referenceAgain)
            ? isLimit(first) || isLimit(reference)
              ? "same with more time"
              : "unsteady"
            : second.end.startsWith("the process ended")
              ? "signal"
              : documentedMessages.some(says) || documentedNames.some(name => texts[index].includes(name))
                ? "documented difference"
                : showsFunctionText
                  ? "function text"
                  : isLimit(second)
                    ? "limit"
                    : second.end !== referenceAgain.end
                      ? "exit-code"
                      : "stdout";
    add(kind);
    if (!["bun-run-signal", "unsteady", "signal", "limit", "exit-code", "stdout"].includes(kind)) continue;
    const summary = `compiled: ${second.end}\nbun run:  ${referenceAgain.end}\n${firstDifference(second.stdout, referenceAgain.stdout)}`;
    let where = "not tried alone";
    if (kind !== "unsteady" && kind !== "bun-run-signal" && isolated++ < maxFindsIsolated) {
      const subset = join(work, `subset-${process.pid}`);
      where = (await differsAmong(subset, [texts[index]], extension, 0))
        ? "differs alone too"
        : "DIFFERS ONLY AMONG NEIGHBORS";
      if (where !== "differs alone too") {
        // Halves the neighbors while the difference stays.
        const first = index - (index % groupSize);
        let neighbors = all.slice(first, first + groupSize).filter(other => other !== index);
        while (neighbors.length > 1) {
          const halves = [neighbors.slice(0, neighbors.length >> 1), neighbors.slice(neighbors.length >> 1)];
          let kept: number[] | undefined;
          for (const half of halves)
            if (!kept && (await differsAmong(subset, [texts[index], ...half.map(other => texts[other])], extension, 0)))
              kept = half;
          if (!kept) break;
          neighbors = kept;
        }
        where +=
          `: ${neighbors.length} of them are enough\n` +
          neighbors
            .slice(0, 8)
            .map(other => `// ---- neighbor\n${texts[other]}`)
            .join("\n");
      }
      rmSync(subset, { recursive: true, force: true });
    }
    keepFind(kind, summary, {
      ["program" + extension]: texts[index],
      "report.txt": `${kind}, one of ${texts.length} programs in groups of ${groupSize}\n${bun} build --compile --aot ${buildFlags.join(" ")}\n${summary}${where}\n`,
      "compiled.stdout": second.stdout,
      "compiled.stderr": second.stderr,
      "bun-run.stdout": referenceAgain.stdout,
      "bun-run.stderr": referenceAgain.stderr,
    });
  }
  rmSync(folder, { recursive: true, force: true });
  const cpuSeconds = Object.values(spent).reduce((sum, stage) => sum + stage.cpuSeconds, 0);
  const stages = Object.entries(spent).map(
    ([stage, { cpuSeconds, wallSeconds, peakMegabytes }]) =>
      `${stage} ${cpuSeconds.toFixed(1)} cpu-s ${wallSeconds.toFixed(1)} s ${peakMegabytes.toFixed(0)} MB`,
  );
  console.log(
    `${new Date().toISOString().slice(11, 19)} batch ${batch}: ${(counts.taken / cpuSeconds).toFixed(1)} programs a processor-second, ${(counts.taken / ((performance.now() - started) / 1000)).toFixed(1)} a second | ${stages.join(" | ")} | ${JSON.stringify(counts)}`,
  );
}
