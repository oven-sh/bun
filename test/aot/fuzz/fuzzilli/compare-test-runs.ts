// Runs a folder of test files under `bun test` and under `bun test --aot` and says in what the two runs differ.
// It is for projects written by hand: a probe of one area, the witness of a fault, a group of an existing suite. run-test-projects.ts draws its own.
//
//   bun compare-test-runs.ts --bun <the Bun that runs the tests> --project <folder> [--flags="--isolate --parallel=2"] [--words TestRunLayers:0] [--files "a.test.js b.test.js"]
//   --each-alone                 every test file in a run of its own, with one trivial test file beside it
//   --each-beside <test file>    every test file in a run of its own, with that file of the project beside it
//   --open                       one more test file, which imports a module under a name that no build can know: then any file may be loaded by name
//   --shrink <test file> --fails "<words of its (fail) line>"   which of the other test files does the failure take? Takes them away by halves for as long as the compiled run prints that line
//   --groups 40 [--stream 0/4]   an existing suite, in place: its test files are shuffled once, always alike, and cut into groups of so many; each group runs plain twice and compiled once.
//                                Printed: the tests that end alike in both plain runs and otherwise compiled. --stream i/n takes every nth group from the ith: n of them share the work
//   --words <words>              BUN_DEBUG_TEST_AOT_WORDS for the compiled run: TestRunLayers:0 | 1 | 2, TestRunPartFiles:<n>, and words for the compiler such as testing=DelayOtherFlowRules
//   --jobs 4                     runs at once, with --each-alone and --each-beside
//   --in-place                   no copy: the runs take place in the project itself and name their test files on the command line. For a large tree; nothing can be added, so not with --open,
//                                and --each-alone has no trivial file beside. One run at a time: two compiled runs in one folder are not independent
//
// WHAT IS COMPARED. The lines that the tests print to stderr and that begin with "SEEN ", sorted; how each test ends, by the lines "(pass) ..", "(fail) .."; whether the exit code is 0.
// A test of a probe prints what it sees, `console.error("SEEN <label> | " + JSON.stringify(value))`, and expects nothing of it, so a wrong value shows although every test passes.
// A run of plain `bun test` that prints no such line says nothing about the compiled one: the form is VOID, not the same.
//
// WHY EACH FILE ALONE. What one file does widens what the build holds for the whole program, and that covers the faults of the others: one eval() admits node:vm's runInContext everywhere,
// one require() of a module gives it a state of its own, one spy on an object from somewhere opens every export. All forms in one run test the union of them. A fault may as well take a
// neighbour: a file that passes alone was refused beside one that takes `test` from Bun.jest(). --shrink finds that neighbour in a group of forty in a few minutes.
//
// Without --in-place the project is copied for every run, so a run changes nothing in it, and two runs never share a folder.
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";

const { values: options } = parseArgs({
  options: {
    bun: { type: "string", default: process.execPath },
    project: { type: "string", default: "" },
    flags: { type: "string", default: "--isolate --parallel=2" },
    words: { type: "string", default: "" },
    files: { type: "string", default: "" },
    "each-alone": { type: "boolean", default: false },
    "each-beside": { type: "string", default: "" },
    open: { type: "boolean", default: false },
    "in-place": { type: "boolean", default: false },
    shrink: { type: "string", default: "" },
    fails: { type: "string", default: "" },
    groups: { type: "string", default: "" },
    stream: { type: "string", default: "0/1" },
    jobs: { type: "string", default: "4" },
    seconds: { type: "string", default: "120" },
  },
});
if (!options.project) throw new Error("--project <folder>");
if (options["in-place"] && options.open) throw new Error("--open adds a file, --in-place adds nothing");
if (options.groups) options["in-place"] = true;
if (options["in-place"]) options.jobs = "1";

const isTestFile = (name: string) => /[._](test|spec)\.[cm]?[jt]sx?$/.test(name);

/** The test files of the project, as paths from its root. */
function findTestFiles(folder: string, from = ""): string[] {
  return readdirSync(join(folder, from)).flatMap(name => {
    if (name === "node_modules") return [];
    const path = from ? from + "/" + name : name;
    return statSync(join(folder, path)).isDirectory() ? findTestFiles(folder, path) : isTestFile(name) ? [path] : [];
  });
}

/** "(pass) name" and the like, each behind the test file under whose heading it is printed. The time that a test took stands behind its name. */
function endsByFile(lines: string[]) {
  let file = "";
  return lines.flatMap(line => {
    if (line.endsWith(":") && isTestFile(line.slice(0, -1))) file = line.slice(0, -1);
    return /^\((pass|fail|skip|todo)\) /.test(line) ? [`${file} ${line.replace(/ \[[\d.]+ms\]$/, "")}`] : [];
  });
}

type Run = { seen: string[]; ends: string[]; isZero: boolean; text: string };

async function run(folder: string, files: string[], isCompiled: boolean): Promise<Run> {
  const child = Bun.spawn({
    cmd: [
      options.bun,
      "test",
      ...(isCompiled ? ["--aot"] : []),
      ...options.flags.split(" ").filter(Boolean),
      ...files.map(file => "./" + file),
    ],
    cwd: folder,
    env: {
      ...process.env,
      NO_COLOR: "1",
      BUN_ENABLE_CRASH_REPORTING: "0",
      ...(isCompiled && options.words ? { BUN_DEBUG_TEST_AOT_WORDS: options.words } : {}),
    },
    stdout: "pipe",
    stderr: "pipe",
    timeout: Number(options.seconds) * 1000,
    killSignal: "SIGKILL",
  });
  const [out, err, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  const lines = (err + out).split("\n");
  return {
    seen: lines.filter(line => line.startsWith("SEEN ")).sort(),
    ends: [...new Set(endsByFile(lines))].sort(),
    isZero: exitCode === 0,
    text: err + out,
  };
}

/** A copy of the project that holds these test files alone, and what the options add. */
function copyWith(files: string[], adds: Record<string, string>) {
  if (options["in-place"]) return options.project;
  const folder = mkdtempSync(join(tmpdir(), "compare-test-runs-"));
  cpSync(options.project, folder, { recursive: true });
  for (const file of findTestFiles(folder)) if (!files.includes(file)) rmSync(join(folder, file));
  for (const [name, text] of Object.entries(adds)) writeFileSync(join(folder, name), text);
  return folder;
}

const trivial = {
  "zz-trivial.test.js": `import { expect, test } from "bun:test";\ntest("trivial", () => { expect(1).toBe(1); });\n`,
};
const opening = {
  "zz-unrelated.js": "export const unrelated = 1;\n",
  "zz-opens-the-modules.test.js": `import { expect, test } from "bun:test";\ntest("a name that no build can know", async () => { expect((await import("./zz-unrelated.js?t=" + Date.now())).unrelated).toBe(1); });\n`,
};

/** "" where the runs agree, "VOID" where plain says nothing, else the lines in which they differ. */
async function compare(files: string[], adds: Record<string, string>): Promise<string> {
  const folder = copyWith(files, { ...adds, ...(options.open ? opening : {}) });
  try {
    const named = options.files || options["in-place"] ? files : [];
    const plain = await run(folder, named, false);
    if (plain.seen.length === 0 && plain.ends.length === 0) return "VOID";
    const compiled = await run(folder, named, true);
    const only = (mine: string[], theirs: string[], mark: string) =>
      mine.filter(line => !theirs.includes(line)).map(line => `  ${mark} ${line.slice(0, 200)}`);
    return [
      ...only(plain.seen, compiled.seen, "plain   "),
      ...only(compiled.seen, plain.seen, "compiled"),
      ...only(plain.ends, compiled.ends, "plain   "),
      ...only(compiled.ends, plain.ends, "compiled"),
      ...(plain.isZero === compiled.isZero
        ? []
        : [`  the exit code is 0 in ${plain.isZero ? "the plain" : "the compiled"} run alone`]),
    ].join("\n");
  } finally {
    if (!options["in-place"]) rmSync(folder, { recursive: true, force: true });
  }
}

async function inParallel<T>(items: T[], act: (item: T) => Promise<void>) {
  const left = [...items];
  await Promise.all(
    Array.from({ length: Number(options.jobs) }, async () => {
      for (let item = left.shift(); item !== undefined; item = left.shift()) await act(item);
    }),
  );
}

const all = options.files ? options.files.split(" ").filter(Boolean) : findTestFiles(options.project).sort();

if (options.shrink) {
  if (!options.fails) throw new Error('--shrink <test file> needs --fails "<words of its (fail) line>"');
  const fails = async (others: string[]) => {
    const folder = copyWith([options.shrink, ...others], {});
    try {
      return (await run(folder, options["in-place"] ? [options.shrink, ...others] : [], true)).text.includes(
        "(fail) " + options.fails,
      );
    } finally {
      if (!options["in-place"]) rmSync(folder, { recursive: true, force: true });
    }
  };
  let others = all.filter(file => file !== options.shrink);
  console.log(
    `with all ${others.length} others: ${(await fails(others)) ? "fails" : "DOES NOT FAIL: nothing to shrink"}`,
  );
  for (let parts = 2; others.length > 0; ) {
    const size = Math.max(1, Math.floor(others.length / parts));
    let isCut = false;
    for (let at = 0; at < others.length && !isCut; at += size) {
      const rest = [...others.slice(0, at), ...others.slice(at + size)];
      if (await fails(rest)) {
        others = rest;
        parts = Math.max(parts - 1, 2);
        isCut = true;
        console.log(`${others.length} left`);
      }
    }
    if (isCut) continue;
    if (size === 1) break;
    parts = Math.min(parts * 2, others.length);
  }
  console.log(
    `it takes ${others.length}:\n${others.map(file => "  " + file).join("\n")}\nalone: ${(await fails([])) ? "fails too" : "passes"}`,
  );
} else if (options.groups) {
  const size = Number(options.groups);
  const shuffled = [...all];
  let state = 1;
  for (let at = shuffled.length - 1; at > 0; at--) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const other = state % (at + 1);
    [shuffled[at], shuffled[other]] = [shuffled[other], shuffled[at]];
  }
  const [stream, streams] = options.stream.split("/").map(Number);
  for (let group = stream; group * size < shuffled.length; group += streams) {
    const files = shuffled.slice(group * size, (group + 1) * size).sort();
    const plain = await run(options.project, files, false);
    const again = await run(options.project, files, false);
    const compiled = await run(options.project, files, true);
    const steady = plain.ends.filter(line => again.ends.includes(line));
    const lost = steady.filter(line => !compiled.ends.includes(line));
    console.log(
      `group ${group}: ${files.length} files, ${plain.ends.length} tests, ${plain.ends.length - steady.length} unsteady, ${lost.length} end otherwise compiled`,
    );
    for (const line of lost) console.log(`  plain    ${line.slice(0, 200)}`);
    if (lost.length) console.log(`  the group: ${files.join(" ")}`);
  }
} else if (options["each-alone"] || options["each-beside"]) {
  const beside = options["each-beside"];
  const counts = { same: 0, differ: 0, void: 0 };
  const said: string[] = [];
  await inParallel(
    all.filter(file => file !== beside && basename(file) !== beside),
    async file => {
      const difference = await compare(beside ? [file, beside] : [file], beside ? {} : trivial);
      counts[difference === "" ? "same" : difference === "VOID" ? "void" : "differ"]++;
      if (difference) said.push(`${file}: ${difference === "VOID" ? "VOID: plain prints nothing" : "\n" + difference}`);
    },
  );
  console.log(
    `${JSON.stringify(counts)} ${options.words}${options.open ? " open" : ""}${beside ? " beside " + beside : ""}`,
  );
  if (said.length) console.log(said.sort().join("\n"));
} else {
  mkdirSync(tmpdir(), { recursive: true });
  const difference = await compare(all, {});
  console.log(difference === "" ? "the same" : difference === "VOID" ? "VOID: plain prints nothing" : difference);
}
