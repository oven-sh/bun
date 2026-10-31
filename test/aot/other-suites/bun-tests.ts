// Bun's own tests as programs for the ahead-of-time compiler: each test file is run twice by the same Bun, `bun test <file>` and `bun test --debug-aot <file>`, which compiles the
// file and all it imports and runs that. The verdicts are compared test by test. A test that fails both ways is the same: the question is what compiling changes.
//
//   bun test/aot/other-suites/bun-tests.ts test/js                     1,400 files, 120 of them the tests of real npm packages (install test/package.json first)
//     --bun <path>          the Bun under test (default: the Bun that runs this script)
//     --reference <path>    the Bun whose plain run is the reference (default: the Bun under test)
//     --plain               nothing is compiled: the Bun under test runs the file plainly too. With --reference: two Buns side by side
//     --jobs <n>            files at a time (default: a quarter of the cores)
//     --only <expression>   the files whose path matches the regular expression
//     --list <file>         the files that it names, one a line, and the folder is not searched
//     --from <n> --to <n>   a part of the sorted list of files
//     --seconds <n>         the limit for a run (default 360)
//     --flags "<flags>"     more flags for the compiled run, for example --aot-erase-types for the files whose own text has type errors
//     --wrap "<command>"    a command in front of every run, for a sandbox. `{seconds}` in it is the run's limit
//     --known <file>        lines of an earlier run: what stands there is counted and not printed
//     --out <folder>        `lines.txt`, one line for every file and every test that differs, and what each run that differs printed
//
// The tests of third parties' packages run those packages' code: give them a sandbox without a network and without your home folder.
//
// One line for each file that is not the same, and one for each of its tests that differs:
//   NOT-BUILT  plain Bun runs the file, the compiler refuses it: the first error
//   DIES       the compiled run ends by a signal, a panic or its time limit, and the plain run does not
//   DIFFERS    <file> > <test>: pass | fail, with the first error of the compiled run
//   TIMES-OUT  <file> > <test>: pass | the test's own time limit. On a busy machine this says little
//   MISSING    <file> > <test>: the plain run reports the test, the compiled run does not
//   BETTER     <file> > <test>: fail | pass
//   EXIT       every test has the same verdict and the two runs end with different exit codes
// Counted and not printed: `same` (every test has the same verdict), `neither` (the plain run reports no test: it needs a service, a package or a platform that is not there).
import { mkdirSync, readdirSync, readFileSync, writeFileSync, type Dirent } from "node:fs";
import { availableParallelism } from "node:os";
import { join, relative, resolve } from "node:path";

const [root, ...rest] = process.argv.slice(2);
const option = (name: string) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
if (!root) {
  console.error("usage: bun test/aot/other-suites/bun-tests.ts <folder of tests> [--bun <path>] [--reference <path>] [--plain] [--jobs <n>] [--only <expression>] [--list <file>] [--from <n>] [--to <n>] [--seconds <n>] [--flags <flags>] [--wrap <command>] [--known <file>] [--out <folder>]");
  process.exit(2);
}
const bun = option("--bun") ?? process.execPath;
const reference = option("--reference") ?? bun;
const isPlain = rest.includes("--plain");
const jobs = Number(option("--jobs")) || Math.max(1, availableParallelism() >> 2);
const only = option("--only") ? new RegExp(option("--only")!) : undefined;
const seconds = Number(option("--seconds")) || 360;
const flags = option("--flags")?.split(" ").filter(flag => flag) ?? [];
const wrap = option("--wrap")?.split(" ").filter(word => word) ?? [];
const out = option("--out");
if (out) mkdirSync(join(out, "printed"), { recursive: true });

const found = () =>
  (readdirSync(root, { recursive: true, withFileTypes: true }) as Dirent[])
    .filter(entry => entry.isFile() && /\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name) && !entry.parentPath.split(/[\\/]/).includes("node_modules"))
    .map(entry => relative(process.cwd(), resolve(entry.parentPath, entry.name)).replaceAll("\\", "/"));
const files = (option("--list") ? readFileSync(option("--list")!, "utf8").split("\n").filter(file => file) : found())
  .filter(file => !only || only.test(file))
  .sort()
  .slice(Number(option("--from")) || 0, Number(option("--to")) || undefined);

// Some tests carry a temporary path, the name of a socket or a port in their names.
const withoutWhatChanges = (name: string) =>
  name
    .replace(/(\/private)?\/(tmp|var\/folders)\/[^\s"',)}]*/g, "<temporary>")
    .replace(/\b[a-z0-9]{8,}\.sock\b/g, "<socket>")
    .replace(/(localhost|127\.0\.0\.1|\[::1\]):\d{4,5}\b/g, "$1:<port>");

type Run = { printed: string; code: number | string; verdicts: Map<string, string>; errors: Map<string, string> };

async function run(file: string, flags: string[], limit: number, runner = bun): Promise<Run> {
  const cmd = [...wrap.map(word => word.replaceAll("{seconds}", String(limit))), runner, "test", "--no-install", ...flags, "--timeout=30000", "./" + file];
  const child = Bun.spawn({ cmd, stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1" }, timeout: (limit + 30) * 1000, killSignal: "SIGKILL" });
  const [stdout, stderr] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  const printed = stdout + stderr;
  const verdicts = new Map<string, string>();
  const errors = new Map<string, string>();
  let error = "";
  const lines = printed.split("\n");
  for (const [at, line] of lines.entries()) {
    const verdict = /^\((pass|fail|skip|todo)\) (.*?)(?: \[[\d.]+m?s\])?$/.exec(line);
    if (!verdict) {
      // The first line of the block in front of a verdict that names an error.
      if (!error && /^(error|\w*Error|panic)\b.*\S/.test(line)) error = line.slice(0, 200);
      continue;
    }
    // A name that occurs twice is numbered. The list of failures at the end repeats each of them: the first verdict stands.
    const written = withoutWhatChanges(verdict[2]);
    if (verdict[1] === "fail" && verdicts.get(written) === "fail") continue;
    let name = written;
    for (let again = 2; verdicts.has(name); again++) name = `${written} (${again})`;
    verdicts.set(name, verdict[1]);
    if (verdict[1] === "fail") errors.set(name, /this test timed out after/.test(lines[at + 1] ?? "") ? "timed out" : error);
    error = "";
  }
  // 124 and 137: the limit of `timeout` in a wrapper. A wrapper also turns a signal into 128 + its number.
  const signals: Record<number, string> = { 132: "SIGILL", 133: "SIGTRAP", 134: "SIGABRT", 135: "SIGBUS", 136: "SIGFPE", 139: "SIGSEGV" };
  const exitCode = child.exitCode ?? -1;
  return { printed, code: child.signalCode ?? (exitCode === 124 || exitCode === 137 ? "the time limit" : (signals[exitCode] ?? exitCode)), verdicts, errors };
}

const firstMatch = (printed: string, expression: RegExp) => printed.split("\n").find(line => expression.test(line))?.slice(0, 220) ?? "";

async function judge(file: string): Promise<string[]> {
  const plain = await run(file, [], seconds, reference);
  if (plain.verdicts.size === 0) return [`neither ${file}: ${firstMatch(plain.printed, /^(error|\w*Error)\b/) || plain.code}`];
  if (plain.code === "the time limit") return [`neither ${file}: the plain run ran out of its time`];
  const compiled = await run(file, isPlain ? [] : ["--debug-aot", ...flags], seconds);
  const lines: string[] = [];
  const death = typeof compiled.code === "string" && compiled.code !== plain.code ? compiled.code : /^panic\b|internal compiler error/m.test(compiled.printed) && !/^panic\b/m.test(plain.printed) ? "a panic" : undefined;
  if (death) lines.push(`DIES ${file}: ${death} (plain ${plain.code}): ${firstMatch(compiled.printed, /panic|internal compiler error|AOT validation|Trap|Segmentation/)}`);
  else if (compiled.verdicts.size === 0) lines.push(`NOT-BUILT ${file}: ${firstMatch(compiled.printed, /^error\b/) || firstMatch(compiled.printed, /\berror\b/i) || compiled.code}`);
  if (compiled.verdicts.size > 0 || death) {
    for (const [name, theirs] of plain.verdicts) {
      const ours = compiled.verdicts.get(name);
      if (ours === theirs) continue;
      if (ours === undefined) lines.push(`MISSING ${file} > ${name}: ${theirs} | nothing`);
      else if (theirs === "fail" && ours === "pass") lines.push(`BETTER ${file} > ${name}: fail | pass`);
      else if (theirs === "pass" && compiled.errors.get(name) === "timed out") lines.push(`TIMES-OUT ${file} > ${name}: pass | its time limit`);
      else lines.push(`DIFFERS ${file} > ${name}: ${theirs} | ${ours}: ${compiled.errors.get(name) ?? ""}`);
    }
    for (const [name, ours] of compiled.verdicts) if (!plain.verdicts.has(name)) lines.push(`DIFFERS ${file} > ${name}: nothing | ${ours}: ${compiled.errors.get(name) ?? ""}`);
  }
  if (lines.length === 0 && compiled.code !== plain.code) lines.push(`EXIT ${file}: ${plain.code} | ${compiled.code}: every one of the ${plain.verdicts.size} tests has the same verdict`);
  if (lines.length === 0) return [`same ${file}: ${plain.verdicts.size} tests`];
  if (out) {
    const name = file.replaceAll("/", "_");
    writeFileSync(join(out, "printed", name + ".plain.txt"), plain.printed);
    writeFileSync(join(out, "printed", name + ".compiled.txt"), compiled.printed);
  }
  return lines;
}

const keyOf = (line: string) => /^[A-Z-]+ (.*?): /.exec(line)?.[1];
const known = new Set(option("--known") ? readFileSync(option("--known")!, "utf8").split("\n").map(keyOf) : []);
const all: string[] = [];
let next = 0;
await Promise.all(
  Array.from({ length: jobs }, async () => {
    while (next < files.length) {
      const lines = await judge(files[next++]);
      all.push(...lines);
      for (const line of lines) if (!/^(same|neither) /.test(line) && !known.has(keyOf(line))) console.log(line);
      if (out) writeFileSync(join(out, "lines.txt"), all.join("\n") + "\n");
    }
  }),
);
const count = (kind: string) => all.filter(line => line.startsWith(kind + " ")).length;
const filesOf = (...kinds: string[]) => new Set(all.filter(line => kinds.some(kind => line.startsWith(kind + " "))).map(line => line.split(" ")[1].replace(/:$/, ""))).size;
console.log(
  `TOTAL ${files.length} files: same ${count("same")}, the plain run reports no test ${count("neither")}, NOT-BUILT ${count("NOT-BUILT")}, DIES ${count("DIES")}, EXIT ${count("EXIT")}; ` +
    `tests: DIFFERS ${count("DIFFERS")} and MISSING ${count("MISSING")} in ${filesOf("DIFFERS", "MISSING")} files, TIMES-OUT ${count("TIMES-OUT")}, BETTER ${count("BETTER")}`,
);
