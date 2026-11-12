// How many lines a second does `bun build --compile --aot` compile, on ordinary application code?
//
//   bun bench/compiler/run.ts                                  every scenario at 10,000, 100,000, 1,000,000 and 5,000,000 lines, three runs each: the table
//   bun bench/compiler/run.ts --sizes=10000 --runs=1           smaller
//   bun bench/compiler/run.ts --scenarios=typed,go-cold        some of them, by their names in the table. A name that is not among them ends the run
//   bun bench/compiler/run.ts --commands                       prints the command of every scenario that would run, and runs none
//   bun bench/compiler/run.ts --bun=<path>                     another Bun than the one that runs this script
//   bun bench/compiler/run.ts --check                          builds every program at the smallest size, runs it, and fails unless every one was built, ended with 0 and printed the same number
//   bun bench/compiler/run.ts --json=<file>                    every number of every run, too
//   bun bench/compiler/run.ts --cores=0-15                     under taskset (Linux)
//
// One application (./generate.ts) in every dress. A size is the number of lines of its typed TypeScript form; every other form is the same application with as many features, and has the lines it has.
// Every number comes from this script: the mean of all runs, none left out. CPU seconds and peak memory are the operating system's for the compiler's process and its children.
// Instructions are counted where `perf` is there. Lines are physical lines of the files that the compiler is given; what it reads besides (declaration files, its own library, Go's standard library) stands in its own column.
// Bun's compiler counts those lines in every build and prints the counts under `--explain=statistics`. Cargo and `bun build --compile` without `--aot` don't tell, so their cells are empty.
// Below the table: the `compile` row of each `bun build --compile --aot`.
// Not a test, and CI does not run it.
import { spawnSync } from "bun";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { generate, write } from "./generate";

const option = (name: string, fallback: string) =>
  process.argv.find(word => word.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const has = (name: string) => process.argv.includes(`--${name}`);
const bun = option("bun", process.execPath);
const sizes = option("sizes", "10000,100000,1000000,5000000").split(",").map(Number);
const runs = Number(option("runs", "3"));
const cores = option("cores", "");
const wanted = option("scenarios", "");
const which = (tool: string) => Bun.which(tool);
const perf = process.platform === "linux" ? which("perf") : null;

interface Scenario {
  name: string;
  dress: string;
  /** What has to be on the machine, the formatter of the language too: a scenario that lacks one is left out, and a line says so. */
  needs?: string[];
  /** Below the folder of the scenario: removed before the timed command of every run, untimed. */
  removes?: string;
  /** Run behind the removal, before the timed command of every run, untimed. */
  prepare?: (folder: string) => string[][];
  command: (folder: string) => string[];
  environment?: (folder: string) => Record<string, string>;
  executable: string;
  entry?: (entry: string) => string;
}

const aot = (entry: string, ...flags: string[]) => [
  bun,
  "build",
  "--compile",
  "--aot",
  "--explain=statistics",
  ...flags,
  entry,
  "--outfile",
  "app",
];
// On Windows Bun and cargo write `<name>.exe`. Go writes the name that it is given, so it is given that one.
const onThisSystem = (executable: string) => (process.platform === "win32" ? `${executable}.exe` : executable);
const builtIn = (folder: string, { executable }: Scenario) => join(folder, onThisSystem(executable));
const open = `\nif (process.argv.length > 90) await import(process.argv[90]);\n`;
const evaluates = `\nif (process.argv.length > 90) eval(process.argv[90]);\n`;
const scenarios: Scenario[] = [
  { name: "typed", dress: "typed", command: () => aot("main.ts"), executable: "app" },
  { name: "typed on one thread", dress: "typed", command: () => aot("main.ts", "--aot-threads=1"), executable: "app" },
  { name: "erased", dress: "erased", command: () => aot("main.js"), executable: "app" },
  {
    name: "erased on one thread",
    dress: "erased",
    command: () => aot("main.js", "--aot-threads=1"),
    executable: "app",
  },
  { name: "mixed", dress: "mixed", command: () => aot("main.ts"), executable: "app" },
  {
    name: "bundled",
    dress: "typed",
    prepare: () => [[bun, "build", "--target=bun", "main.ts", "--outfile", "bundle.js"]],
    command: () => aot("bundle.js"),
    executable: "app",
  },
  {
    name: "bundled and minified",
    dress: "typed",
    prepare: () => [[bun, "build", "--target=bun", "--minify", "main.ts", "--outfile", "bundle.js"]],
    command: () => aot("bundle.js"),
    executable: "app",
  },
  { name: "packages with declarations", dress: "packages-typed", command: () => aot("main.ts"), executable: "app" },
  { name: "packages without types", dress: "packages-untyped", command: () => aot("main.js"), executable: "app" },
  {
    name: "typed in an open world",
    dress: "typed",
    entry: text => text + open,
    command: () => aot("main.ts", "--aot-allow-code-from-disk"),
    executable: "app",
  },
  {
    name: "erased in an open world",
    dress: "erased",
    entry: text => text + open,
    command: () => aot("main.js", "--aot-allow-code-from-disk"),
    executable: "app",
  },
  {
    name: "typed with direct eval",
    dress: "typed",
    entry: text => text + evaluates,
    command: () => aot("main.ts"),
    executable: "app",
  },
  {
    name: "bun build --compile without --aot",
    dress: "typed",
    command: () => [bun, "build", "--compile", "main.ts", "--outfile", "app"],
    executable: "app",
  },
  {
    name: "go-cold",
    dress: "go",
    needs: ["go", "gofmt"],
    removes: ".cache",
    command: () => ["go", "build", "-o", onThisSystem("app"), "."],
    environment: folder => ({ GOCACHE: join(folder, ".cache"), GOFLAGS: "-mod=mod", GOTOOLCHAIN: "local" }),
    executable: "app",
  },
  {
    name: "go-std-warm",
    dress: "go",
    needs: ["go", "gofmt"],
    removes: ".cache",
    prepare: () => [["go", "build", "std"]],
    command: () => ["go", "build", "-o", onThisSystem("app"), "."],
    environment: folder => ({ GOCACHE: join(folder, ".cache"), GOFLAGS: "-mod=mod", GOTOOLCHAIN: "local" }),
    executable: "app",
  },
  {
    name: "cargo build",
    dress: "rust",
    needs: ["cargo", "rustfmt"],
    removes: "target",
    command: () => ["cargo", "build", "--offline", "--quiet"],
    executable: "target/debug/application",
  },
  {
    name: "cargo build --release",
    dress: "rust",
    needs: ["cargo", "rustfmt"],
    removes: "target",
    command: () => ["cargo", "build", "--offline", "--quiet", "--release"],
    executable: "target/release/application",
  },
];

const unknown = wanted ? wanted.split(",").filter(name => !scenarios.some(scenario => scenario.name === name)) : [];
if (unknown.length) {
  const quoted = unknown.map(name => JSON.stringify(name)).join(", ");
  console.error(
    `--scenarios: there is no ${quoted}. The scenarios:\n${scenarios.map(({ name }) => `  ${name}`).join("\n")}`,
  );
  process.exit(1);
}

const shown = (command: string[]) => command.map(word => (word === bun ? "bun" : word)).join(" ");
function printCommandsOf(chosen: Scenario[]) {
  const widest = Math.max(...chosen.map(scenario => scenario.name.length), "scenario".length);
  for (const scenario of chosen) {
    const removal = scenario.removes ? [["rm", "-rf", scenario.removes]] : [];
    const before = [...removal, ...(scenario.prepare?.(".") ?? [])].map(shown).join(" && ");
    console.log(
      `${scenario.name.padEnd(widest)}  ${shown(scenario.command("."))}${before ? `   (before it, not timed: ${before})` : ""}`,
    );
  }
  return widest;
}
if (has("commands")) {
  printCommandsOf(scenarios.filter(scenario => !wanted || wanted.split(",").includes(scenario.name)));
  process.exit(0);
}

function countLines(
  folder: string,
  extensions: string[],
  skip: string[] = [],
): { lines: number; bytes: number; files: number } {
  const total = { lines: 0, bytes: 0, files: 0 };
  for (const name of readdirSync(folder, { recursive: true }) as string[]) {
    if (!extensions.some(extension => name.endsWith(extension)) || skip.some(part => name.includes(part))) continue;
    const text = readFileSync(join(folder, name));
    total.files++;
    total.bytes += text.length;
    let lines = 0;
    for (let index = text.indexOf(10); index >= 0; index = text.indexOf(10, index + 1)) lines++;
    total.lines += lines + (text.length && text[text.length - 1] !== 10 ? 1 : 0);
  }
  return total;
}

interface Measured {
  wall: number;
  cpu: number;
  peakMB: number;
  instructions?: number;
  /** Bun's compiler only: `[1.31s] compile  app  126.4 MB  8.2k lines/s`. */
  compileRow?: string;
  /** Only Bun's compiler counts them: the lines of declaration files and of its own library. */
  linesReadBesides?: number;
}

const compileRowOfBuild = /^ *\[[\d.]+m?s\] compile  .* lines\/s$/m;

function linesReadBesidesIn(stderr: string) {
  const declarations = /^SourceLinesOfDeclarations (\d+)$/m.exec(stderr);
  const library = /^SourceLinesOfBun (\d+)$/m.exec(stderr);
  return declarations && library ? Number(declarations[1]) + Number(library[1]) : undefined;
}

function time(command: string[], cwd: string, env: Record<string, string>): Measured {
  const counts = join(cwd, "perf.txt");
  const whole = [
    ...(cores ? ["taskset", "-c", cores] : []),
    ...(perf ? [perf, "stat", "-x,", "-e", "instructions:u", "-o", counts, "--"] : []),
    ...command,
  ];
  const start = performance.now();
  const result = spawnSync({
    cmd: whole,
    cwd,
    env: { ...process.env, NO_COLOR: "1", ...env },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 3_600_000,
  });
  const wall = (performance.now() - start) / 1000;
  if (result.exitCode !== 0)
    throw new Error(`${command.join(" ")} in ${cwd}: exit ${result.exitCode}\n${result.stdout}${result.stderr}`);
  const usage = result.resourceUsage!;
  const counted = perf ? Number(/^(\d+),/m.exec(readFileSync(counts, "utf8"))?.[1]) : undefined;
  return {
    wall,
    cpu: Number(usage.cpuTime.total) / 1e6,
    peakMB: usage.maxRSS / (1 << 20),
    instructions: counted || undefined,
    compileRow: compileRowOfBuild.exec(result.stdout.toString())?.[0].trim(),
    linesReadBesides: linesReadBesidesIn(result.stderr.toString()),
  };
}

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const whole = (value: number) => Math.round(value).toLocaleString("en-US");
const linesOfFeature = countLinesOf(generate(40, "typed")) / 40;

function countLinesOf(files: Record<string, string>) {
  return Object.entries(files)
    .filter(([name]) => name.endsWith(".ts"))
    .reduce((sum, [, text]) => sum + text.split("\n").length - 1, 0);
}

const results: any[] = [];
const answers = new Map<string, string>();
const root = mkdtempSync(join(tmpdir(), "bench-compiler-"));
try {
  for (const size of has("check") ? [Math.min(...sizes, 3000)] : sizes) {
    const features = Math.max(2, Math.round(size / linesOfFeature));
    for (const scenario of scenarios) {
      if (wanted && !wanted.split(",").includes(scenario.name)) continue;
      const missing = scenario.needs?.find(tool => !which(tool));
      if (missing) {
        console.error(`${scenario.name}: no ${missing} on this machine: left out`);
        continue;
      }
      const folder = join(root, `${size}-${scenario.name.replace(/[^a-z0-9]+/gi, "-")}`);
      const files = generate(features, scenario.dress);
      for (const entry of ["main.ts", "main.js"])
        if (scenario.entry && files[entry]) files[entry] = scenario.entry(files[entry]);
      write(folder, files);
      if (scenario.dress === "go") spawnSync({ cmd: ["gofmt", "-w", "."], cwd: folder });
      if (scenario.dress === "rust") spawnSync({ cmd: ["rustfmt", "--edition", "2021", "src/main.rs"], cwd: folder });
      const env = scenario.environment?.(folder) ?? {};
      const measured: Measured[] = [];
      // A compiler that fails or takes over an hour at some size has a row that says so. Nothing is left out in silence.
      let failure: string | undefined;
      for (let run = 0; !failure && run < (has("check") ? 1 : runs); run++) {
        try {
          if (scenario.removes) rmSync(join(folder, scenario.removes), { recursive: true, force: true });
          for (const command of scenario.prepare?.(folder) ?? []) {
            const prepared = spawnSync({
              cmd: command,
              cwd: folder,
              env: { ...process.env, ...env },
              stdout: "pipe",
              stderr: "pipe",
            });
            if (prepared.exitCode !== 0)
              throw new Error(`${command.join(" ")}: exit ${prepared.exitCode}\n${prepared.stderr}`);
          }
          measured.push(time(scenario.command(folder), folder, env));
        } catch (error) {
          // The first line names the command. A command that printed nothing has that line alone.
          const [first, ...printed] = String(error).trim().split("\n");
          failure = (printed.slice(0, 3).join(" ") || first).slice(0, 300);
        }
      }
      if (failure) {
        results.push({ scenario: scenario.name, size, features, failure });
        console.error(`${size} ${scenario.name}: FAILED: ${failure}`);
        rmSync(folder, { recursive: true, force: true });
        continue;
      }
      const isBundled = scenario.name.startsWith("bundled");
      // A bundle is the application in one file: its speed is told in the application's lines, or a minified one, which has a few dozen, would say nothing.
      const given =
        scenario.dress === "go"
          ? countLines(folder, [".go"], [".cache"])
          : scenario.dress === "rust"
            ? countLines(folder, [".rs"], ["target"])
            : countLines(folder, [".ts", ".js"], [".d.ts", "bundle.js"]);
      const besides =
        scenario.dress === "go" ? linesOfGoStandardLibrary(folder, env) : measured.at(-1)!.linesReadBesides;
      const row = {
        scenario: scenario.name,
        size,
        features,
        lines: given.lines,
        bytes: given.bytes,
        files: given.files,
        bundle: isBundled ? countLines(folder, ["bundle.js"]) : undefined,
        linesReadBesides: scenario.name === "go-std-warm" ? 0 : besides,
        runs: measured.length,
        wallSeconds: mean(measured.map(run => run.wall)),
        cpuSeconds: mean(measured.map(run => run.cpu)),
        peakMB: mean(measured.map(run => run.peakMB)),
        instructions: measured[0].instructions === undefined ? undefined : mean(measured.map(run => run.instructions!)),
        executableBytes: statSync(builtIn(folder, scenario)).size,
        compileRow: measured.at(-1)!.compileRow,
        everyRun: measured,
      };
      results.push(row);
      console.error(
        `${size} ${scenario.name}: ${whole(row.lines)} lines, ${row.wallSeconds.toFixed(2)} s, ${row.cpuSeconds.toFixed(2)} CPU-s`,
      );
      if (has("check")) {
        const ran = spawnSync({ cmd: [builtIn(folder, scenario)], stdout: "pipe", stderr: "pipe" });
        if (ran.exitCode === 0) answers.set(scenario.name, ran.stdout.toString().trim());
        else {
          const failure = `its executable ended with ${ran.signalCode ?? ran.exitCode}: ${ran.stderr.toString().trim().slice(0, 300)}`;
          results.push({ scenario: scenario.name, size, features, failure });
        }
      }
      rmSync(folder, { recursive: true, force: true });
    }
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

function linesOfGoStandardLibrary(folder: string, env: Record<string, string>) {
  const listed = spawnSync({
    cmd: ["go", "list", "-deps", "-f", "{{if .Standard}}{{range .GoFiles}}{{$.Dir}}/{{.}}\n{{end}}{{end}}", "."],
    cwd: folder,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  let lines = 0;
  for (const file of listed.stdout.toString().split("\n"))
    if (file.trim()) lines += readFileSync(file.trim(), "utf8").split("\n").length - 1;
  return lines;
}

if (has("check")) {
  for (const [name, answer] of answers) console.log(`${answer}  ${name}`);
  // What was not built or did not run to its end has printed no number, so it agrees with nobody.
  const failed = results.filter(row => row.failure);
  for (const row of failed) console.log(`FAILED  ${row.scenario}: ${row.failure}`);
  if (failed.length) console.error("NOT EVERY PROGRAM WAS BUILT AND RUN");
  else if (!answers.size) console.error("NO PROGRAM WAS BUILT AND RUN");
  else if (new Set(answers.values()).size !== 1) console.error("THE PROGRAMS DO NOT AGREE");
  else process.exit(0);
  process.exit(1);
}

const version = (command: string[]) =>
  spawnSync({ cmd: command, stdout: "pipe", stderr: "pipe" }).stdout.toString().trim();
const ran = scenarios.filter(scenario => results.some(row => row.scenario === scenario.name));
console.log(
  `One application, written by bench/compiler/generate.ts in every form below. The mean of ${runs} run${runs === 1 ? "" : "s"}.`,
);
console.log(
  `${process.platform} ${process.arch}, ${navigator.hardwareConcurrency} processors${cores ? `, taskset -c ${cores}` : ""}, load ${loadavg()[0].toFixed(1)} at the end\n`,
);
console.log(`bun    ${version([bun, "--revision"])}`);
if (which("go")) console.log(`go     ${version(["go", "version"]).replace("go version ", "")}`);
if (which("rustc")) console.log(`rustc  ${version(["rustc", "--version"]).replace("rustc ", "")}`);
console.log("");
const widest = printCommandsOf(ran);
const columns: [string, number, (row: any) => string][] = [
  ["wall s", 9, row => row.wallSeconds.toFixed(2)],
  ["lines/s", 10, row => whole(row.lines / row.wallSeconds)],
  ["lines", 11, row => whole(row.lines)],
  ["CPU s", 10, row => row.cpuSeconds.toFixed(2)],
  ["lines/CPU s", 12, row => whole(row.lines / row.cpuSeconds)],
  ["instructions/line", 18, row => (row.instructions ? whole(row.instructions / row.lines) : "")],
  ["peak MB", 9, row => whole(row.peakMB)],
  ["executable MB", 14, row => (row.executableBytes / 1e6).toFixed(1)],
  ["lines read besides", 19, row => (row.linesReadBesides === undefined ? "" : whole(row.linesReadBesides))],
];
for (const size of new Set(results.map(row => row.size))) {
  const rows = results.filter(row => row.size === size);
  console.log(`\n${whole(size)} lines of typed TypeScript asked for: ${whole(rows[0].features)} features`);
  console.log("scenario".padEnd(widest) + columns.map(([name, width]) => name.padStart(width)).join(""));
  for (const row of rows)
    console.log(
      row.scenario.padEnd(widest) +
        (row.failure
          ? `  FAILED: ${row.failure}`
          : columns.map(([, width, text]) => text(row).padStart(width)).join("")),
    );
}
const rowsWithCompileRow = results.filter(row => row.compileRow);
if (rowsWithCompileRow.length) {
  console.log("\nThe compile row of bun's build, in the last run");
  for (const row of rowsWithCompileRow)
    console.log(`${whole(row.size).padStart(9)}  ${row.scenario.padEnd(widest)}  ${row.compileRow}`);
}
if (option("json", "")) writeFileSync(option("json", ""), JSON.stringify(results, null, 2) + "\n");
