// usage: bun raw.ts --scratch <clone with the corpus> --bin <binary> --from <observed/instances.tsv> --out <file.jsonl>
//          [--jobs 4] [--timeout 120000] [--keep <directory>] [--every] [instance name ...]
// Lays instances out again as sweep.ts does (its function layOut) and starts `<binary> --lint <root files>` as the
// default check does (check_bun_lint.ts: the operands, the current directory, the environment), and writes what came
// back as it is, one JSON line per instance: exit code, signal, stdout, stderr with the root cut off the paths.
// Without a name: the instances whose outcome in the table is crash or timeout. --every: all of the table.
// Where the command died (a signal, an exit code that is not 0 or 2, stdout, a line of stderr that is no diagnostic,
// or the time limit), every root file is given to the command alone, and the record says which of them reproduce it.
// --keep <directory>: the files of such an instance stay below <directory>/<instance name>/.
// Run it with the INSTALLED bun. At most --jobs processes of the binary run at a time.
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const valued = new Set(["--scratch", "--bin", "--from", "--out", "--jobs", "--timeout", "--keep"]);
const options: Record<string, string> = {};
const wanted: string[] = [];
let every = false;
for (let k = 0; k < argv.length; k++) {
  const a = argv[k];
  if (valued.has(a)) options[a] = argv[++k];
  else if (a === "--every") every = true;
  else wanted.push(a);
}
for (const needed of ["--scratch", "--bin", "--from", "--out"]) {
  if (options[needed] === undefined) {
    console.error(`raw.ts: ${needed} is missing`);
    process.exit(2);
  }
}
const home = resolve(options["--scratch"], "test/cli/lint/conformance");
const bin = resolve(options["--bin"]);
const outPath = resolve(options["--out"]);
const jobs = Number(options["--jobs"] ?? "4");
const timeoutMs = Number(options["--timeout"] ?? "120000");
const keep = options["--keep"] === undefined ? undefined : resolve(options["--keep"]);
if (!(jobs >= 1 && jobs <= 4)) {
  console.error("raw.ts: --jobs is 1 to 4");
  process.exit(2);
}

const { corpusPaths } = await import(join(home, "runner/paths.ts"));
const { enumerateCase } = await import(join(home, "runner/compiler_runner.ts"));
const { instanceInput, toRealPath } = await import(join(home, "runner/materialise.ts"));
const { parseTestFilesAndSymlinks } = await import(join(home, "runner/test_case_parser.ts"));
const { readFile } = await import(join(home, "runner/vfs.ts"));
const { getNormalizedAbsolutePath } = await import(join(home, "runner/tspath.ts"));
const { parsePlainDiagnostics } = await import(join(home, "runner/tsc_plain_format.ts"));

const paths = corpusPaths(join(home, "corpus"));

interface Line {
  name: string;
  kind: string;
  casePath: string;
  outcome: string;
  class: string;
}
const table: Line[] = readFileSync(resolve(options["--from"]), "utf8")
  .split("\n")
  .filter(line => line !== "")
  .map(line => {
    const [name, kind, casePath, outcome, cls] = line.split("\t");
    return { name, kind, casePath, outcome, class: cls };
  });
const byName = new Map(table.map(line => [line.name, line]));
let selected: Line[];
if (wanted.length > 0) {
  selected = wanted.map(name => {
    const line = byName.get(name);
    if (line === undefined) {
      console.error(`raw.ts: ${name} is no instance of the table`);
      process.exit(2);
    }
    return line;
  });
} else if (every) {
  selected = table;
} else {
  selected = table.filter(line => line.outcome === "crash" || line.outcome === "timeout");
}

// check_bun_lint.ts spawnEnvironment.
const env: Record<string, string> = {};
for (const [name, value] of Object.entries(process.env)) if (value !== undefined) env[name] = value;
env.BUN_FEATURE_FLAG_EXPERIMENTAL_LINT = "1";
env.BUN_DEBUG_QUIET_LOGS = "1";
env.NO_COLOR = "1";
delete env.FORCE_COLOR;
delete env.BUN_OPTIONS;

const physical = (directory: string): string => {
  try {
    return realpathSync.native(directory);
  } catch {
    return directory;
  }
};

interface Ran {
  ms: number;
  exitCode: number | null;
  signal: string | number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  stderrBytes: number;
  // Why the output is not that of a run that ended by itself with a list of diagnostics; empty for such a run.
  died: string;
}

async function start(operands: string[], cwd: string, root: string): Promise<Ran> {
  const began = performance.now();
  const proc = Bun.spawn({
    cmd: [bin, "--lint", ...operands],
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
  if (timedOut) died = "the time limit";
  else if (proc.signalCode !== null) died = `signal ${proc.signalCode}`;
  else if (proc.exitCode !== 0 && proc.exitCode !== 2) died = `exit code ${proc.exitCode}`;
  else if (stdout !== "") died = "stdout";
  else {
    const parsed = parsePlainDiagnostics(stderr);
    if (!parsed.ok) died = `stderr line ${parsed.at} is ${parsed.reason}`;
  }
  const cut = (text: string, most: number) =>
    text.length > most ? text.slice(0, most - 4000) + "\n<<<cut>>>\n" + text.slice(-4000) : text;
  return {
    ms,
    exitCode: proc.exitCode,
    signal: proc.signalCode,
    timedOut,
    // A panic of a debug build writes its frames to stdout: the first of them are kept.
    stdout: stdout.replaceAll(root, "").slice(0, 8000),
    stderr: cut(stderr.replaceAll(root, ""), 40000),
    stderrBytes: stderr.length,
    died,
  };
}

const base = mkdtempSync(join(realpathSync.native(tmpdir()), "lint-survey-raw-"));
writeFileSync(outPath, "");
let next = 0;
let done = 0;
let deaths = 0;
const began = performance.now();

async function one(line: Line, index: number): Promise<Record<string, unknown>> {
  const record: Record<string, unknown> = { name: line.name, kind: line.kind, casePath: line.casePath, was: line.class };
  const enumerated = enumerateCase(paths.cases, line.casePath).find((i: { name: string }) => i.name === line.name);
  if (enumerated === undefined) return { ...record, notLaid: "the case has no instance of that name" };
  const rootDirectory = join(base, index.toString(36));
  try {
    const filename = `${paths.cases}/${line.casePath}`;
    const read = readFile(filename);
    if (!read.ok) return { ...record, notLaid: "the case cannot be read" };
    const units = parseTestFilesAndSymlinks(read.contents, filename, (unitName: string, content: string) => ({
      value: { name: unitName, content },
      error: undefined,
    }));
    if (!units.ok) return { ...record, notLaid: units.reason };
    const made = instanceInput(units, enumerated.config, rootDirectory, { libDirectory: paths.lib });
    if (!made.ok) return { ...record, notLaid: made.reason };
    // check_bun_lint.ts createSpawnCheck: the operands and the current directory.
    const root = physical(resolve(rootDirectory));
    const currentDirectory = getNormalizedAbsolutePath(made.input.currentDirectory, "/");
    const virtual: string[] = made.input.rootFiles.map((name: string) => getNormalizedAbsolutePath(name, currentDirectory));
    const operands = virtual.map(name => toRealPath(root, name));
    const cwd = physical(toRealPath(root, currentDirectory));
    record.roots = virtual;
    record.currentDirectory = currentDirectory;
    const ran = await start(operands, cwd, root);
    Object.assign(record, ran);
    if (ran.died !== "") {
      deaths++;
      const alone: Record<string, unknown>[] = [];
      for (let k = 0; k < operands.length; k++) {
        const single = await start([operands[k]], cwd, root);
        alone.push({
          file: virtual[k],
          died: single.died,
          exitCode: single.exitCode,
          signal: single.signal,
          ms: single.ms,
          stdout: single.stdout.slice(0, 4000),
          stderr: single.stderr.split("\n").slice(0, 60).join("\n"),
        });
      }
      record.alone = alone;
      if (keep !== undefined) {
        const kept = join(keep, line.name);
        rmSync(kept, { recursive: true, force: true });
        mkdirSync(keep, { recursive: true });
        cpSync(root, kept, { recursive: true, verbatimSymlinks: true });
        record.kept = kept;
      }
    }
    return record;
  } catch (error) {
    return { ...record, threw: String(error) };
  } finally {
    try {
      if (existsSync(rootDirectory)) rmSync(rootDirectory, { recursive: true, force: true });
    } catch {}
  }
}

async function worker(): Promise<void> {
  for (let k = next++; k < selected.length; k = next++) {
    const record = await one(selected[k], k);
    appendFileSync(outPath, JSON.stringify(record) + "\n");
    if (++done % 200 === 0) {
      console.error(`${done} of ${selected.length}, ${Math.round((performance.now() - began) / 1000)} s, died ${deaths}`);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(jobs, selected.length) }, worker));
rmSync(base, { recursive: true, force: true });
console.log(`raw.ts: ${done} instances in ${Math.round((performance.now() - began) / 1000)} s, the command died in ${deaths}`);
