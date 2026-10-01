// usage: bun direct.ts --tree <clone with the corpus> --bin <binary> --out <file.jsonl> (--not-laid-out | --units | --cases)
//          [--jobs 2] [--timeout 120000] [--batch 40] [--from <k>] [--to <n>] [--keep <directory>] [--pty plain|color]
// The files of the corpus that sweep.ts never hands to the command, straight through `<binary> --lint`:
//   --not-laid-out  every run instance that the sweep refuses before it starts a process (outcome unsupported:
//                   an absolute name in a text, a DOS root, a request for a disk without case). The command opens
//                   nothing but its operands, so the root files are written without the rest and given to it.
//   --units         every file of every case (all units, roots or not, of instances that run or are skipped) that
//                   has an extension with a loader, --batch files to a process. --from/--to cut the list of cases.
//   --cases         every case file as it lies in the corpus (corpus/cases/**/*.ts and *.tsx, with its directive
//                   lines, all units in one text, in the encoding of upstream: some have a byte order mark or are
//                   UTF-16, which no laid-out unit is), --batch files to a process.
// A run "died" by the rules of check_bun_lint.ts readRun: a signal, the time limit, an exit code that is not 0 or 2,
// a text on stdout, or a line of stderr that is no diagnostic. Exit code 1 is in that list on purpose: it is what a
// report of AddressSanitizer ends a debug build with when abort_on_error is not set.
// Where a process with several files died, every file is given to the command alone, and the record names the ones
// that die alone. One JSON line per process that died or per instance (--not-laid-out); the last line is the summary.
// --pty: the command gets a terminal (util-linux `script -qec`), where it writes code frames instead of the lines of
// tsc (lint_command.rs write_diagnostics): another writer, which no sweep reaches. plain: NO_COLOR=1; color: colours
// forced. With a terminal the output is one stream and is not parsed: a run died by its signal or exit code, or when
// its text holds "panic" or "Sanitizer".
// Run it with the INSTALLED bun. At most --jobs (1 to 4) processes of the binary run at a time.
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const argv = process.argv.slice(2);
const valued = new Set(["--tree", "--bin", "--out", "--jobs", "--timeout", "--batch", "--from", "--to", "--keep", "--pty"]);
const options: Record<string, string> = {};
const flags = new Set<string>();
for (let k = 0; k < argv.length; k++) {
  if (valued.has(argv[k])) options[argv[k]] = argv[++k];
  else flags.add(argv[k]);
}
const mode = flags.has("--not-laid-out") ? "not-laid-out" : flags.has("--units") ? "units" : flags.has("--cases") ? "cases" : undefined;
if (mode === undefined || ["--tree", "--bin", "--out"].some(name => options[name] === undefined)) {
  console.error("usage: bun direct.ts --tree <clone> --bin <binary> --out <file.jsonl> (--not-laid-out | --units)");
  process.exit(2);
}
const home = resolve(options["--tree"], "test/cli/lint/conformance");
const bin = resolve(options["--bin"]);
const outPath = resolve(options["--out"]);
const jobs = Number(options["--jobs"] ?? "2");
const timeoutMs = Number(options["--timeout"] ?? "120000");
const batchSize = Number(options["--batch"] ?? "40");
const keep = options["--keep"] === undefined ? undefined : resolve(options["--keep"]);
const pty = options["--pty"];
if (pty !== undefined && pty !== "plain" && pty !== "color") {
  console.error("direct.ts: --pty is plain or color");
  process.exit(2);
}
if (!(jobs >= 1 && jobs <= 4)) {
  console.error("direct.ts: --jobs is 1 to 4");
  process.exit(2);
}

const { corpusPaths, suites } = await import(join(home, "runner/paths.ts"));
const { enumerateCase, enumerateInstances } = await import(join(home, "runner/compiler_runner.ts"));
const { findObstacles, instanceInput, probePlatform } = await import(join(home, "runner/materialise.ts"));
const { parseTestFilesAndSymlinks } = await import(join(home, "runner/test_case_parser.ts"));
const { readFile } = await import(join(home, "runner/vfs.ts"));
const { getNormalizedAbsolutePath } = await import(join(home, "runner/tspath.ts"));
const { parsePlainDiagnostics } = await import(join(home, "runner/tsc_plain_format.ts"));
const { loadOracleTable, oracleOf, diffRootOf } = await import(join(home, "runner/oracle.ts"));

const paths = corpusPaths(join(home, "corpus"));

// check_bun_lint.ts spawnEnvironment.
const env: Record<string, string> = {};
for (const [name, value] of Object.entries(process.env)) if (value !== undefined) env[name] = value;
env.BUN_FEATURE_FLAG_EXPERIMENTAL_LINT = "1";
env.BUN_DEBUG_QUIET_LOGS = "1";
env.NO_COLOR = "1";
delete env.FORCE_COLOR;
delete env.BUN_OPTIONS;
if (pty === "color") {
  delete env.NO_COLOR;
  env.FORCE_COLOR = "1";
  env.TERM = "xterm-256color";
}
const quote = (a: string) => `'${a.replaceAll("'", `'\\''`)}'`;

interface Ran {
  ms: number;
  exitCode: number | null;
  signal: string | number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  // Why the output is not that of a run that ended by itself with a list of diagnostics; empty for such a run.
  died: string;
  // The diagnostics by category and code, for a run that did not die.
  codes: Record<string, number>;
}

async function start(operands: string[], cwd: string, root: string): Promise<Ran> {
  const began = performance.now();
  const command = [bin, "--lint", ...operands];
  const proc = Bun.spawn({
    cmd: pty === undefined ? command : ["script", "-qec", command.map(quote).join(" "), "/dev/null"],
    cwd,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const ms = Math.round(performance.now() - began);
  const timedOut = ms >= timeoutMs && proc.signalCode !== null;
  let died = "";
  const codes: Record<string, number> = {};
  if (timedOut) died = "the time limit";
  else if (proc.signalCode !== null) died = `signal ${proc.signalCode}`;
  else if (proc.exitCode !== 0 && proc.exitCode !== 2) died = `exit code ${proc.exitCode}`;
  else if (pty !== undefined) {
    const m = /panic|Sanitizer/.exec(stdout + stderr);
    if (m !== null) died = `the text holds "${m[0]}"`;
    else {
      // The heads of the code frames, by category: "error: syntax: text".
      for (const h of (stdout + stderr).replace(/\x1b\[[0-9;]*m/g, "").matchAll(/^(error|warn|warning|note|message|suggestion): (?:([A-Za-z@][A-Za-z0-9@\/_-]*): )?/gm)) {
        const key = `${h[1]} ${h[2] ?? ""}`.trim();
        codes[key] = (codes[key] ?? 0) + 1;
      }
    }
  } else if (stdout !== "") died = "stdout";
  else {
    const parsed = parsePlainDiagnostics(stderr);
    if (!parsed.ok) died = `stderr line ${parsed.at} is ${parsed.reason}`;
    else {
      let errors = 0;
      for (const d of parsed.diagnostics) {
        const key = `${d.category} ${d.rule ?? `TS${d.code}`}`;
        codes[key] = (codes[key] ?? 0) + 1;
        if (d.category === "error") errors++;
      }
      if (proc.exitCode === 0 && errors > 0) died = `the exit code is 0 and stderr has ${errors} errors`;
      if (proc.exitCode === 2 && errors === 0) died = "the exit code is 2 and stderr has no error";
    }
  }
  const cut = (text: string, most: number) =>
    text.length > most ? text.slice(0, most - 2000) + "\n<<<cut>>>\n" + text.slice(-2000) : text;
  return {
    ms,
    exitCode: proc.exitCode,
    signal: proc.signalCode,
    timedOut,
    stdout: cut(stdout.replaceAll(root, ""), 6000),
    stderr: cut(stderr.replaceAll(root, ""), died === "" ? 3000 : 12000),
    died,
    codes,
  };
}

// A name of an instance as a path below a directory: a DOS root becomes a directory.
function below(root: string, virtualName: string): string {
  const name = virtualName.replace(/^([a-zA-Z]):/, "/$1_").replaceAll(":", "_");
  return root + (name.startsWith("/") ? name : `/${name}`);
}

function listCases(): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(`${paths.cases}/${rel}`, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${rel}/${entry.name}`);
      else if (/\.tsx?$/.test(entry.name)) out.push(`${rel}/${entry.name}`);
    }
  };
  for (const suite of suites) walk(suite);
  return out.sort();
}

interface Laid {
  ok: boolean;
  reason: string;
  currentDirectory: string;
  rootFiles: string[];
  // Every file of the file system of the program: name and bytes.
  files: { path: string; data: Uint8Array }[];
  obstacles: string[];
}

const base = mkdtempSync(join(realpathSync.native(tmpdir()), "lint-survey-direct-"));
const platform = probePlatform(base);

// The files of an instance without a disk, as sweep.ts layOut makes them, and what keeps them from this disk.
function layOutWithoutDisk(casePath: string, config: unknown): Laid {
  const none = { currentDirectory: "/", rootFiles: [], files: [], obstacles: [] };
  const filename = `${paths.cases}/${casePath}`;
  const read = readFile(filename);
  if (!read.ok) return { ok: false, reason: "the case cannot be read", ...none };
  const units = parseTestFilesAndSymlinks(read.contents, filename, (unitName: string, content: string) => ({
    value: { name: unitName, content },
    error: undefined,
  }));
  if (!units.ok) return { ok: false, reason: units.reason, ...none };
  const made = instanceInput(units, config, undefined, { libDirectory: paths.lib });
  if (!made.ok) {
    // The units as they are written in the case, for a case that the harness stops at.
    const files = (units.units as { name: string; content: string }[]).map(u => ({
      path: getNormalizedAbsolutePath(u.name, "/"),
      data: Buffer.from(u.content, "utf8") as Uint8Array,
    }));
    return { ok: false, reason: `${made.status}: ${made.reason}`, ...none, files };
  }
  const currentDirectory = getNormalizedAbsolutePath(made.input.currentDirectory, "/");
  const files = (made.test.fileSystem as { kind: string; path: string; data: Uint8Array }[])
    .filter(entry => entry.kind === "file")
    .map(entry => ({ path: entry.path, data: entry.data }));
  const obstacles = (findObstacles(made.test, platform) as { reason: string; detail: string }[]).map(
    o => `${o.reason}${o.detail === "" ? "" : `: ${o.detail}`}`,
  );
  return {
    ok: true,
    reason: "",
    currentDirectory,
    rootFiles: made.input.rootFiles.map((name: string) => getNormalizedAbsolutePath(name, currentDirectory)),
    files,
    obstacles,
  };
}

writeFileSync(outPath, "");
const record = (line: Record<string, unknown>) => appendFileSync(outPath, JSON.stringify(line) + "\n");
const began = performance.now();
const seconds = () => Math.round((performance.now() - began) / 1000);
let processes = 0;
let deaths = 0;
let slowest = { ms: 0, what: "" };
const codesTotal: Record<string, number> = {};
const note = (ran: Ran, what: string) => {
  processes++;
  if (ran.ms > slowest.ms) slowest = { ms: ran.ms, what };
  for (const [key, n] of Object.entries(ran.codes)) codesTotal[key] = (codesTotal[key] ?? 0) + n;
};

async function pool<T>(items: T[], work: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    for (let k = next++; k < items.length; k = next++) await work(items[k], k);
  };
  await Promise.all(Array.from({ length: Math.min(jobs, items.length) }, worker));
}

if (mode === "not-laid-out") {
  const table = loadOracleTable(paths);
  const refused: { name: string; kind: string; casePath: string; laid: Laid }[] = [];
  let run = 0;
  for (const instance of enumerateInstances(paths.cases)) {
    if (instance.status !== "run") continue;
    if (diffRootOf(table, instance.suite, instance.name).fatal !== undefined) continue;
    run++;
    const laid = layOutWithoutDisk(instance.file, instance.config);
    if (laid.ok && laid.obstacles.length === 0) continue;
    const kind = oracleOf(table, instance.suite, instance.name).class;
    refused.push({ name: instance.name, kind, casePath: instance.file, laid });
  }
  console.error(`run instances ${run}; not laid out on this disk ${refused.length}; ${seconds()} s`);
  const byReason: Record<string, number> = {};
  let withoutOperand = 0;
  await pool(refused, async ({ name, kind, casePath, laid }, index) => {
    const reason = laid.ok ? laid.obstacles[0].replace(/: .*/s, "") : laid.reason;
    byReason[reason] = (byReason[reason] ?? 0) + 1;
    const root = join(base, index.toString(36));
    const line: Record<string, unknown> = { name, kind, casePath, refusal: laid.ok ? laid.obstacles.join("; ") : laid.reason };
    const data = new Map(laid.files.map(file => [file.path, file.data]));
    const roots = laid.rootFiles.filter(path => data.has(path));
    if (roots.length === 0) {
      withoutOperand++;
      record({ ...line, notRun: "no root file to write" });
      return;
    }
    try {
      for (const path of roots) {
        mkdirSync(dirname(below(root, path)), { recursive: true });
        writeFileSync(below(root, path), data.get(path)!);
      }
      const cwd = below(root, laid.currentDirectory);
      mkdirSync(cwd, { recursive: true });
      const ran = await start(
        roots.map(path => below(root, path)),
        cwd,
        root,
      );
      note(ran, name);
      Object.assign(line, { roots, ...ran });
      if (ran.died !== "") {
        deaths++;
        const alone: Record<string, unknown>[] = [];
        for (const path of roots) {
          const single = await start([below(root, path)], cwd, root);
          alone.push({ file: path, died: single.died, exitCode: single.exitCode, signal: single.signal, stderr: single.stderr.slice(0, 4000), stdout: single.stdout.slice(0, 3000) });
        }
        line.alone = alone;
        if (keep !== undefined) {
          mkdirSync(keep, { recursive: true });
          cpSync(root, join(keep, name), { recursive: true });
        }
      }
      record(line);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  record({ summary: true, mode, run, notLaidOut: refused.length, withoutOperand, processes, deaths, byReason, codes: codesTotal, slowest, seconds: seconds() });
  console.log(`direct.ts --not-laid-out: ${refused.length} of ${run} run instances, ${processes} processes, died ${deaths}, ${seconds()} s`);
  console.log(JSON.stringify({ byReason, codes: codesTotal, slowest }));
} else {
  const loaded = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
  const all = listCases();
  const from = Number(options["--from"] ?? "0");
  const to = Number(options["--to"] ?? String(all.length));
  const cases = all.slice(from, to);
  interface Unit {
    casePath: string;
    name: string;
    real: string;
  }
  const units: Unit[] = [];
  let withoutHarness = 0;
  let withoutLoader = 0;
  let libFiles = 0;
  const seenLib = new Set<string>();
  for (const [k, casePath] of cases.entries()) {
    if (mode === "cases") {
      units.push({ casePath, name: "(the case file)", real: `${paths.cases}/${casePath}` });
      continue;
    }
    const first = enumerateCase(paths.cases, casePath)[0];
    const laid = layOutWithoutDisk(casePath, first?.config);
    if (!laid.ok) withoutHarness++;
    const directory = join(base, (from + k).toString(36));
    let n = 0;
    for (const file of laid.files) {
      // The files of /.lib are the same bytes in every case that mounts them.
      if (file.path.startsWith("/.lib/")) {
        if (seenLib.has(file.path)) continue;
        seenLib.add(file.path);
        libFiles++;
      }
      if (!loaded.test(file.path)) {
        withoutLoader++;
        continue;
      }
      const real = below(directory, file.path);
      mkdirSync(dirname(real), { recursive: true });
      writeFileSync(real, file.data);
      units.push({ casePath, name: file.path, real });
      n++;
    }
  }
  console.error(`cases ${cases.length} (${from} to ${to} of ${all.length}); files with a loader ${units.length}; without ${withoutLoader}; cases that the harness stops at ${withoutHarness}; ${seconds()} s`);
  const batches: Unit[][] = [];
  for (let k = 0; k < units.length; k += batchSize) batches.push(units.slice(k, k + batchSize));
  let done = 0;
  let deadFiles = 0;
  await pool(batches, async (batch, index) => {
    const ran = await start(
      batch.map(u => u.real),
      base,
      base,
    );
    note(ran, `batch ${index} (${batch[0].casePath} ...)`);
    if (ran.died !== "") {
      const line: Record<string, unknown> = { batch: index, files: batch.length, first: batch[0].casePath, last: batch[batch.length - 1].casePath, died: ran.died, exitCode: ran.exitCode, signal: ran.signal, ms: ran.ms };
      const alone: Record<string, unknown>[] = [];
      for (const u of batch) {
        const single = batch.length === 1 ? ran : await start([u.real], base, base);
        if (batch.length > 1) note(single, `${u.casePath} ${u.name}`);
        if (single.died === "") continue;
        deadFiles++;
        alone.push({ casePath: u.casePath, unit: u.name, died: single.died, exitCode: single.exitCode, signal: single.signal, ms: single.ms, stderr: single.stderr.slice(0, 6000), stdout: single.stdout.slice(0, 4000) });
        if (keep !== undefined) {
          const kept = join(keep, u.casePath.replaceAll("/", "__") + "--" + u.name.replaceAll("/", "__"));
          mkdirSync(keep, { recursive: true });
          cpSync(u.real, kept);
        }
      }
      line.alone = alone;
      if (alone.length === 0) {
        // No file dies alone: the text of the process with all of them is what there is.
        line.stderr = ran.stderr;
        line.stdout = ran.stdout;
        line.operands = batch.map(u => `${u.casePath} ${u.name}`);
      }
      deaths++;
      record(line);
    }
    if (++done % 25 === 0) console.error(`${done} of ${batches.length} processes, ${seconds()} s, died ${deaths}`);
  });
  record({ summary: true, mode, cases: cases.length, from, to, files: units.length, withoutLoader, withoutHarness, libFiles, batch: batchSize, processes, batchesThatDied: deaths, filesThatDieAlone: deadFiles, codes: codesTotal, slowest, seconds: seconds() });
  console.log(`direct.ts --${mode}: ${units.length} files of ${cases.length} cases in ${batches.length} processes of ${batchSize}, died ${deaths}, files that die alone ${deadFiles}, ${seconds()} s`);
  console.log(JSON.stringify({ codes: codesTotal, slowest }));
}
rmSync(base, { recursive: true, force: true });
