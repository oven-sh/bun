// Compares the machine code of the C and C++ sources that this tree changed, as a build that is not the
// portable image compiles them, in this tree and in a tree of the commit the work started from. What
// compare-asm.ts does for the crates.
//
//   bun compare-cpp.ts --base <tree> --build <dir> --vendor <dir> --deps <dir> --codegen <dir> [options]
//       --base <tree>      a tree of the commit the work started from
//       --branch <tree>    the tree that is compared with it (default: the tree of this file)
//       --build <dir>      a build directory of the branch that `bun scripts/build.ts --configure-only
//                          --profile=release --build-dir=<dir>` wrote: its compile_commands.json has the
//                          command of every source, its unified/ says which bundle a source is in
//       --vendor <dir>     the sources of the dependencies (vendor/ of a tree that has built)
//       --deps <dir>       the headers that the dependencies generate (deps/ of a build directory that has
//                          built)
//       --codegen <dir>    the generated headers (codegen/ of a build directory that has built, or of
//                          `scripts/build.ts --mode=codegen`); the same for both trees
//       --files a,b        instead of the sources that differ from the base and the sources that include
//                          a header that differs
//       --work <dir>       where the assembly and the report go (default: build/portable/compare-cpp)
//       --jobs <n>         (default 8)
//
// Each source is compiled by itself, once from each tree, with the command of its bundle and these
// changes: no link-time optimisation (it leaves bitcode, no machine code), no debug information (its
// line numbers move with every edit), no precompiled header (root.h is included in its place), and the
// name of the tree in `__FILE__` made the same. The two files of assembly are compared by
// compare-asm.ts.
//
// A source that has more lines than it had gives the assertions behind them another `__LINE__`: the
// number that RELEASE_ASSERT passes on when it fails. Where the assembly of a source differs in nothing
// but such numbers, each one the number of the same line of source in the two trees, the result says
// so ("line_numbers") and names the functions.
//
// Exit code 0: nothing differs. 1: something does. 2: a source did not compile.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const argv = process.argv.slice(2);
const options: Record<string, string> = {};
for (let i = 0; i < argv.length; i++) {
  if (!argv[i]!.startsWith("--")) throw new Error(`what is ${argv[i]}?`);
  options[argv[i]!.slice(2)] = argv[++i] ?? "";
}
const here = dirname(import.meta.path);
const branch = resolve(options.branch ?? join(here, "../../.."));
for (const name of ["base", "build", "vendor", "deps", "codegen"])
  if (!options[name]) throw new Error(`--${name} <dir>: see the comment at the top of this file`);
const base = resolve(options.base!);
const build = resolve(options.build!);
const vendor = resolve(options.vendor!);
const deps = resolve(options.deps!);
const codegen = resolve(options.codegen!);
const work = resolve(options.work ?? join(branch, "build/portable/compare-cpp"));
const jobs = Number(options.jobs ?? "8");

function git(tree: string, args: string[]): string {
  const ran = Bun.spawnSync(["git", "-C", tree, ...args], { stdout: "pipe", stderr: "pipe", maxBuffer: 1 << 28 });
  if (ran.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${ran.stderr.toString()}`);
  return ran.stdout.toString().trim();
}

const isSource = (file: string) => /\.(c|cc|cpp|cxx)$/.test(file);
const isHeader = (file: string) => /\.(h|hh|hpp)$/.test(file);

interface Command {
  file: string;
  arguments: string[];
}
const commands: Command[] = (JSON.parse(readFileSync(join(build, "compile_commands.json"), "utf8")) as any[]).map(
  entry => ({
    file: entry.file,
    // The words are written as a shell reads them, in either form.
    arguments: entry.arguments ? (entry.arguments as string[]).flatMap(splitCommand) : splitCommand(entry.command),
  }),
);

/** The words of a command line as a shell reads them. */
function splitCommand(command: string): string[] {
  const out: string[] = [];
  let word = "";
  let quote = "";
  let any = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!;
    if (quote) {
      if (c === quote) quote = "";
      else if (c === "\\" && quote === '"' && i + 1 < command.length) word += command[++i];
      else word += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      any = true;
    } else if (c === "\\" && i + 1 < command.length) {
      word += command[++i];
      any = true;
    } else if (c === " " || c === "\t" || c === "\n") {
      if (word || any) out.push(word);
      word = "";
      any = false;
    } else word += c;
  }
  if (word || any) out.push(word);
  return out;
}

// Which bundle has a source: the bundle includes it by its path.
const bundleOf = new Map<string, string>();
const unified = join(build, "unified");
if (existsSync(unified)) {
  for (const name of readdirSync(unified)) {
    const path = join(unified, name);
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const include = /^\s*#\s*include\s+"([^"]+)"/.exec(line);
      if (include) bundleOf.set(resolve(unified, include[1]!), path);
    }
  }
}

const baseCommit = git(base, ["rev-parse", "HEAD"]);
let files: string[];
const notes: string[] = [];
if (options.files) files = options.files.split(",");
else {
  const changed = [
    ...git(branch, ["diff", "--name-only", baseCommit]).split("\n"),
    ...git(branch, ["ls-files", "--others", "--exclude-standard"]).split("\n"),
  ].filter(file => file && (file.startsWith("src/") || file.startsWith("packages/")));
  const sources = new Set(changed.filter(isSource));
  // A header that differs: every source of the base that names it in an #include.
  const headers = changed.filter(isHeader).filter(file => existsSync(join(base, file)));
  if (headers.length > 0) {
    const names = headers.map(file => file.split("/").pop()!);
    const listed = git(base, [
      "grep",
      "-l",
      "-E",
      `#\\s*include\\s+["<]([^">]*/)?(${names.map(name => name.replace(/[.+]/g, "\\$&")).join("|")})[">]`,
      "--",
      "src",
      "packages",
    ]);
    for (const file of listed.split("\n")) if (isSource(file)) sources.add(file);
  }
  files = [...sources].sort();
}

interface Result {
  file: string;
  state: "the same" | "different" | "not compared";
  why?: string;
  symbols?: number;
  different?: unknown[];
  /** Every line of assembly that differs has another number of the same line of source, and nothing else. */
  line_numbers?: { places: number; only_line_numbers: boolean; other: string[] };
  output?: string;
}

/**
 * The lines of two files of assembly that differ, each as what it is: the number of a line of the source,
 * which is the same line in the two trees, or something else.
 */
function lineNumbers(before: string, after: string, baseSource: string, branchSource: string): Result["line_numbers"] {
  const diff = Bun.spawnSync(["diff", "--speed-large-files", before, after], { stdout: "pipe", maxBuffer: 1 << 30 })
    .stdout.toString()
    .split("\n");
  const baseLines = readFileSync(baseSource, "utf8").split("\n");
  const branchLines = readFileSync(branchSource, "utf8").split("\n");
  let places = 0;
  const other: string[] = [];
  const numbers = (line: string) => line.replace(/#.*$/, "").match(/\b\d+\b/g) ?? [];
  const without = (line: string) =>
    line
      .replace(/#.*$/, "")
      .replace(/\b\d+\b/g, "N")
      .trim();
  for (let at = 0; at < diff.length; at++) {
    const header = /^(\d+)(?:,(\d+))?([acd])(\d+)(?:,(\d+))?$/.exec(diff[at]!);
    if (header === null) continue;
    const removed: string[] = [];
    const added: string[] = [];
    for (at++; at < diff.length && !/^\d/.test(diff[at]!); at++) {
      if (diff[at]!.startsWith("< ")) removed.push(diff[at]!.slice(2));
      else if (diff[at]!.startsWith("> ")) added.push(diff[at]!.slice(2));
    }
    at--;
    if (removed.length !== added.length) {
      other.push(`${header[0]}: ${removed.length} lines for ${added.length}`);
      continue;
    }
    for (let index = 0; index < removed.length; index++) {
      const x = numbers(removed[index]!);
      const y = numbers(added[index]!);
      const differing = x.map((value, i) => [value, y[i]] as const).filter(([a, b]) => a !== b);
      const sameLine =
        without(removed[index]!) === without(added[index]!) &&
        differing.length === 1 &&
        baseLines[Number(differing[0]![0]) - 1] !== undefined &&
        baseLines[Number(differing[0]![0]) - 1]!.trim() === branchLines[Number(differing[0]![1]) - 1]?.trim();
      if (sameLine) places++;
      else other.push(`${removed[index]!.trim()}  ->  ${added[index]!.trim()}`);
    }
  }
  return { places, only_line_numbers: other.length === 0 && places > 0, other: other.slice(0, 20) };
}

function commandFor(file: string): Command | undefined {
  const path = join(branch, file);
  const direct = commands.find(command => command.file === path);
  if (direct) return direct;
  const bundle = bundleOf.get(path);
  return bundle === undefined ? undefined : commands.find(command => command.file === bundle);
}

/** The arguments that compile one source of one tree to assembly. */
function argumentsFor(command: Command, tree: string, file: string, output: string): string[] {
  const out: string[] = [];
  const from = command.arguments;
  for (let i = 0; i < from.length; i++) {
    const argument = from[i]!;
    if (argument === "-c") continue;
    if (
      argument === "-o" ||
      argument === "-include-pch" ||
      argument === "-MF" ||
      argument === "-MT" ||
      argument === "-MQ"
    ) {
      i++;
      continue;
    }
    if (argument === "-Xclang" && (from[i + 1] === "-include-pch" || from[i + 1] === "-fno-pch-timestamp")) {
      i += from[i + 1] === "-include-pch" ? 3 : 1;
      continue;
    }
    if (
      /^-flto/.test(argument) ||
      argument === "-fwhole-program-vtables" ||
      argument === "-fforce-emit-vtables" ||
      argument === "-fno-split-lto-unit"
    )
      continue;
    if (/^-g/.test(argument) || argument === "-MD" || argument === "-MMD" || /^-fdiagnostics-color/.test(argument))
      continue;
    if (argument === command.file) continue;
    if (argument.startsWith("-I")) {
      const directory = argument.slice(2);
      if (directory === join(build, "codegen")) out.push(`-I${codegen}`);
      else if (directory.startsWith(join(build, "deps") + "/"))
        out.push(`-I${join(deps, relative(join(build, "deps"), directory))}`);
      else if (directory.startsWith(join(branch, "vendor") + "/"))
        out.push(`-I${join(vendor, relative(join(branch, "vendor"), directory))}`);
      else if (directory === branch || directory.startsWith(branch + "/"))
        out.push(`-I${join(tree, relative(branch, directory))}`);
      else out.push(argument);
      continue;
    }
    out.push(argument);
  }
  const isCxx = !file.endsWith(".c");
  if (isCxx) out.push("-include", join(tree, "src/jsc/bindings/root.h"));
  out.push(`-fmacro-prefix-map=${tree}=.`, "-g0", "-S", "-o", output, join(tree, file));
  return out;
}

mkdirSync(work, { recursive: true });
const results: Result[] = [];
const queue = [...files];
async function worker(): Promise<void> {
  for (;;) {
    const file = queue.shift();
    if (file === undefined) return;
    if (!existsSync(join(base, file))) {
      results.push({ file, state: "not compared", why: "not in the base: a source of this tree" });
      continue;
    }
    if (!existsSync(join(branch, file))) {
      results.push({ file, state: "not compared", why: "not in this tree" });
      continue;
    }
    const command = commandFor(file);
    if (command === undefined) {
      results.push({ file, state: "not compared", why: "the build has no command for it" });
      continue;
    }
    const name = file.replace(/[^A-Za-z0-9.]/g, "_");
    const outputs: string[] = [];
    let failed: string | undefined;
    for (const [side, tree] of [
      ["base", base],
      ["branch", branch],
    ] as const) {
      const output = join(work, `${name}.${side}.s`);
      const args = argumentsFor(command, tree, file, output);
      const ran = Bun.spawn(args, { cwd: build, stdout: "pipe", stderr: "pipe" });
      const [errors, code] = await Promise.all([new Response(ran.stderr).text(), ran.exited]);
      writeFileSync(join(work, `${name}.${side}.log`), `${args.join(" ")}\n${errors}`);
      if (code !== 0) {
        failed = `${side} does not compile: ${join(work, `${name}.${side}.log`)}`;
        break;
      }
      outputs.push(output);
    }
    if (failed !== undefined) {
      results.push({ file, state: "not compared", why: failed });
      continue;
    }
    const compared = Bun.spawnSync(["bun", join(here, "compare-asm.ts"), outputs[0]!, outputs[1]!], {
      stdout: "pipe",
      stderr: "pipe",
      maxBuffer: 1 << 28,
    });
    const output = join(work, `${name}.compared.json`);
    writeFileSync(output, compared.stdout.toString());
    let parsed: any;
    try {
      parsed = JSON.parse(compared.stdout.toString());
    } catch {
      results.push({ file, state: "not compared", why: `compare-asm.ts said what is no JSON: ${output}` });
      continue;
    }
    const different = [
      ...(parsed.different ?? []),
      ...(parsed.only_before ?? []).map((s: string) => `only the base: ${s}`),
      ...(parsed.only_after ?? []).map((s: string) => `only this tree: ${s}`),
    ];
    const same = compared.exitCode === 0;
    results.push({
      file,
      state: same ? "the same" : "different",
      symbols: parsed.symbols_in_both,
      different: same ? undefined : different,
      line_numbers: same ? undefined : lineNumbers(outputs[0]!, outputs[1]!, join(base, file), join(branch, file)),
      output,
    });
  }
}
await Promise.all(Array.from({ length: Math.max(1, jobs) }, worker));
results.sort((x, y) => (x.file < y.file ? -1 : 1));

const report = {
  base: baseCommit,
  branch: git(branch, ["rev-parse", "HEAD"]),
  not_committed: git(branch, ["status", "--short"]).split("\n").filter(Boolean).length,
  notes,
  sources: results.length,
  the_same: results.filter(result => result.state === "the same").length,
  different: results.filter(result => result.state === "different").length,
  different_in_line_numbers_only: results.filter(result => result.line_numbers?.only_line_numbers).length,
  not_compared: results.filter(result => result.state === "not compared").length,
  symbols_compared: results.reduce((sum, result) => sum + (result.symbols ?? 0), 0),
  results,
};
const path = join(work, "cpp.json");
writeFileSync(path, JSON.stringify(report, null, 1) + "\n");
console.log(JSON.stringify({ ...report, results: undefined, report: path }, null, 1));
for (const result of results) if (result.state !== "the same") console.log(JSON.stringify(result, null, 1));
process.exit(report.not_compared ? 2 : report.different ? 1 : 0);
