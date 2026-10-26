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
    // Kinds of outcomes that are only counted otherwise, separated by commas.
    "also-keep": { type: "string", default: "" },
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
const alsoKept = options["also-keep"].split(",").filter(Boolean);
const buildFlags = [
  ...options.flags.split(" ").filter(Boolean),
  ...(hidesFunctionText ? ["--no-compile-function-source"] : []),
];
const runner = "run-each-program-in-a-worker.ts";
const mark = `=== ${Math.random().toString(36).slice(2)} ended`;
const maxFindsIsolated = 8;
// A program that prints without end would fill the disk. How much a run can write to a file, in blocks of 512 bytes.
const maxBlocksWritten = (256 << 20) / 512;

type Spent = { cpuSeconds: number; wallSeconds: number; peakMegabytes: number };
type Ended = { stdout: string; stderr: string; end: string; stoppedBefore?: number[] };
const spent: Record<string, Spent> = {};

async function spawn(stage: string, cmd: string[], cwd: string, env: Record<string, string>, seconds: number) {
  const [stdout, stderr] = [join(cwd, `${stage}.stdout`), join(cwd, `${stage}.stderr`)];
  // A child writes over the start of a file that exists and leaves the rest.
  for (const path of [stdout, stderr]) rmSync(path, { force: true });
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
  texts.forEach((text, index) => {
    // Behind a line "// @filename: ./<name>" stands a file that the program imports by that name. The name is a hash of the file, so programs can share one.
    const [program, ...others] = text.split(/^\/\/ @filename: \.\/(\S+)\n/m);
    // An empty catch block at the top level would hide the message of a documented difference. It goes to stderr, which isn't compared.
    const cast = extension.endsWith("ts") ? " as any" : "";
    writeFileSync(
      join(folder, "programs", index + extension),
      program.replace(
        /\} catch ?\((e\d*)\) \{\n?\}$/gm,
        (_, caught) => `} catch (${caught}) { console.error(String((${caught}${cast})?.message)); }`,
      ),
      "latin1",
    );
    for (let other = 0; other < others.length; other += 2)
      writeFileSync(join(folder, "programs", others[other]), others[other + 1], "latin1");
  });
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

/** The programs in `folder` that import the file beside them, or a file that imports it. The names of such files are hashes. */
function importersOf(file: string, folder: string) {
  const texts = new Map(
    readdirSync(join(folder, "programs")).map(name => [name, readFileSync(join(folder, "programs", name), "latin1")]),
  );
  const isProgram = (name: string) => /^\d+\./.test(name);
  const importers = new Set([file]);
  for (const imported of importers)
    if (!isProgram(imported))
      for (const [name, text] of texts) if (text.includes(imported.replace(/\.[a-z]+$/, ""))) importers.add(name);
  return [...importers].filter(isProgram).map(name => parseInt(name));
}

/** Builds the executable. Returns the programs that the errors name, or how the compiler stopped. */
async function build(
  folder: string,
  programCount: number,
  extension: string,
  inGroup: number,
  mode = ["--aot", ...buildFlags],
) {
  const groups = Array.from(
    { length: Math.ceil(programCount / inGroup) },
    (_, group) => `./group-${group}${extension}`,
  );
  const ran = await spawn(
    "build",
    [bun, "build", "--compile", ...mode, "./" + runner, ...groups, "--outfile", join(folder, "batch")],
    folder,
    {},
    60 + programCount,
  );
  // "error: .." or "warn: ..", and below it "at <file>:<line>:<column>".
  const [refused, writesToBuiltins] = [new Set<number>(), new Set<number>()];
  let header = "";
  for (const line of ran.stderr.split("\n")) {
    if (/^(error|warn|note)\b/.test(line)) header = line;
    const [, file, index] = /^\s+at .*programs[\\/]((?:(\d+)\.)?[^\\/:]+):\d+/.exec(line) ?? [];
    if (file === undefined) continue;
    for (const program of index === undefined ? importersOf(file, folder) : [Number(index)]) {
      if (header.startsWith("error")) refused.add(program);
      if (header.includes("read-only in a compiled executable")) writesToBuiltins.add(program);
    }
  }
  if (ran.exitCode === 0 && existsSync(join(folder, "batch"))) return { refused: new Set<number>(), writesToBuiltins };
  // Of several such lines, the first that names a program.
  const stops = [
    ...ran.stderr.matchAll(
      /internal compiler error.*?(?:programs[\\/](\d+)\.[a-z]+\b.*)?$|Stopped while compiling.*?(?:programs[\\/](\d+)\.[a-z]+\b.*)?$/gm,
    ),
  ];
  const [reason, ...named] = stops.find(([, ...named]) => named.some(index => index !== undefined)) ?? stops[0] ?? [];
  if (!ran.signal && reason === undefined && refused.size) return { refused, writesToBuiltins };
  const culprit = named.find(index => index !== undefined);
  return {
    refused,
    writesToBuiltins,
    stopped: {
      reason: `${ran.signal ?? `exit code ${ran.exitCode}`}: ${reason ?? "the errors name no program"}`,
      culprit: culprit === undefined ? undefined : Number(culprit),
      stderr: ran.stderr.slice(-8000),
    },
  };
}

/**
 * Runs the programs one after the other in one process. When the process ends early, the program it was in gets the blame and the rest run in a new process.
 * The thread of a program that the runner stopped can outlive its mark, so the blamed program also lists those.
 */
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
      [
        "sh",
        "-c",
        `ulimit -f ${maxBlocksWritten}; exec "$0" "$@"`,
        ...command,
        String(inGroup),
        extension.slice(1),
        ...left.map(String),
      ],
      folder,
      { ...env, BATCH_MARK: mark, BATCH_MILLISECONDS: String(limit) },
      30 + (left.length * limit) / 100,
    );
    const split = (text: string) => text.split(new RegExp(`\\n${mark} (\\d+) (\\S+)\\n`));
    const [stdout, stderr] = [split(ran.stdout), split(ran.stderr)];
    const marks = (Math.min(stdout.length, stderr.length) / 3) | 0;
    // The thread of a program that the runner stopped can write into a mark. The programs from there on run again.
    let ended = 0;
    while (
      ended < marks &&
      Number(stdout[3 * ended + 1]) === left[ended] &&
      Number(stderr[3 * ended + 1]) === left[ended]
    )
      ended++;
    for (let position = 0; position < ended; position++) {
      results.set(left[position], {
        stdout: stdout[3 * position],
        stderr: stderr[3 * position],
        end: stdout[3 * position + 2],
      });
    }
    if (ended < left.length)
      results.set(left[ended], {
        stdout: stdout[3 * ended],
        stderr: stderr[3 * ended].slice(-4000),
        // Behind the bound nothing is written any more, so the marks of the programs that follow are missing too.
        end:
          ended < marks || Math.max(ran.stdout.length, ran.stderr.length) >= maxBlocksWritten * 512
            ? "output"
            : `the process ended: ${ran.signal ?? `exit code ${ran.exitCode}`}`,
        stoppedBefore: left.slice(0, ended).filter(index => isLimit(results.get(index)!)),
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

/** `Reflect.setPrototypeOf()` of a built-in object returns false in an executable, and `Object.setPrototypeOf()` throws. */
// `bun run` replaces the length and the characters of a string that it knows by their values, also below `delete`.
const deletesTheLengthOfAString = /\bdelete \(?(?:"[^"\n]*"|t\d+)(?: as any)?\)?\.length\b/;
const deletesACharacterOfAString =
  /\bdelete \(?"[^"\n]*"(?: as any)?\)?\[\d+\]|\bconst (t\d+) = "[^"\n]*";\n.*\bdelete \(?\1(?: as any)?\)?\[\d+\]/;
const setsThePrototypeOfABuiltIn = /\bsetPrototypeOf\([A-Z]/;

// What `bun run` says when it refuses a file that the compiler builds.
const refusalsOfBunRun = [
  "is a constant",
  "Left side of assignment is not a reference",
  "Unexpected token '...'",
  "Unexpected private name",
  "Ambiguous unary expression",
  "cannot cross static block boundary",
];

/** `console.log(error)` prints lines of the source, which an executable doesn't have, a message, whose words can differ, and a stack. A time is that of the run. */
const removeDetailsOfErrors = (output: string) =>
  output
    .replace(/[ \t]*\d+ \| .*\n(?:\s*\d+ \| .*\n|[\^~ ]+\n)*/g, " ")
    .split("\n")
    .filter(line => !/^\s*(\d+ \| |[\^~ ]+$|at )/.test(line))
    .map(line =>
      line
        .replace(/^\s+(?=\w*Error\b)/, "")
        .replace(/Error: .*/, "Error")
        .replace(/\[(\w*Function): [^\]]*\]/g, "[$1]")
        .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g, "<a time>")
        .replace(/\b\d{1,2} [A-Z][a-z]{2} \d\d:\d\d:\d\d\b/g, "<a time>")
        .replace(
          /\b[A-Z][a-z]{2},? (?:[A-Z][a-z]{2} \d\d|\d\d [A-Z][a-z]{2}) \d{4} \d\d:\d\d:\d\d GMT\S*(?: \([^)]*\))?/g,
          "<a time>",
        ),
    )
    .join("\n");
const agree = (a: Ended, b: Ended) =>
  a.end === b.end && removeDetailsOfErrors(a.stdout) === removeDetailsOfErrors(b.stdout);
/** The text of a function is a key or a part of a string, and the two runs differ in where its lines break and in parentheses that change nothing. */
const withoutLayout = (output: string) => removeDetailsOfErrors(output).replace(/\\n|[\s()]/g, "");
const agreeButForLayout = (a: Ended, b: Ended) =>
  a.end === b.end && withoutLayout(a.stdout) === withoutLayout(b.stdout);
/**
 * Whether an object literal or a class in `text` has two getters, or two setters, of one name. Where that key stands among the others differs then.
 * A generated program has one member a line, indented by its depth.
 */
function definesAnAccessorTwice(text: string) {
  const bodies: { indent: number; accessors: Set<string> }[] = [];
  for (const line of text.split("\n")) {
    const indent = line.search(/\S/);
    if (indent < 0) continue;
    while (bodies.length && bodies.at(-1)!.indent > indent) bodies.pop();
    const accessor = /^\s*((?:static )?[gs]et (?:[\w$#]+|"[^"]*"))\(/.exec(line)?.[1];
    if (!accessor) continue;
    if (bodies.at(-1)?.indent !== indent) bodies.push({ indent, accessors: new Set() });
    if (bodies.at(-1)!.accessors.has(accessor)) return true;
    bodies.at(-1)!.accessors.add(accessor);
  }
  return false;
}
/** A function under a computed key that is a literal shows that key as its name in an executable: `[Function: 1.5]` for `[Function]`. */
const hasALiteralAsComputedKey = /^\s*(?:(?:static|async|get|set)\s+)*\*?\s*\[\(?-?(?:\d|NaN\b|Infinity\b|")/m;
const withoutNamesOfFunctions = (output: string) =>
  removeDetailsOfErrors(output).replace(/\[(\w*Function|class)\b[^\]]*\]/g, "[$1]");
const opensAFunctionOrAClass =
  /\bfunction\b|\bclass\b|^\s*static \{$|^\s*(?!(?:if|for|while|switch|catch|with)\b)(?:(?:static|async|get|set)\s+)*\*?\s*(?:[\w$#]+|"[^"]*"|\[.*\])\s*\(.*\{$/;
/** `text` with `undefined` for `this` outside every function and class. In a module that is `undefined` in an executable and `null` under `bun run`. */
function withUndefinedAsThisOfTheModule(text: string) {
  const blocks: { indent: number; hasItsOwnThis: boolean }[] = [];
  return text
    .split("\n")
    .map(line => {
      const indent = line.search(/\S/);
      if (indent < 0) return line;
      while (blocks.length && blocks.at(-1)!.indent >= indent) blocks.pop();
      const isOfTheModule = !blocks.some(block => block.hasItsOwnThis);
      const opens = opensAFunctionOrAClass.test(line);
      if (line.endsWith("{")) blocks.push({ indent, hasItsOwnThis: opens });
      if (!isOfTheModule) return line;
      if (!opens) return line.replace(/\bthis\b/g, "undefined");
      // The computed key of a method belongs to the code around the method.
      return line.replace(
        /^(\s*(?:(?:async|get|set)\s+)*\*?\s*\[)(.*)(\]\s*\()/,
        (_, before, key, after) => before + key.replace(/\bthis\b/g, "undefined") + after,
      );
    })
    .join("\n");
}
const readsThisOfTheModule = (text: string) => withUndefinedAsThisOfTheModule(text) !== text;
const withNullAsUndefined = (output: string) =>
  removeDetailsOfErrors(output)
    .replace(/\[Object: null prototype\] /g, "")
    .replace(/\bnull\b/g, "undefined");
const isLimit = ({ end }: Ended) => end === "time" || end === "memory" || end === "output";
/** Thousands of buffers that can grow take more addresses than a process can reserve. */
const reservedTooManyAddresses = ({ stderr }: Ended) => stderr.includes("mprotect failed: Cannot allocate memory");
const classOfError = ({ stderr }: Ended) => /\b\w*Error\b/.exec(stderr)?.[0];

function keepFind(kind: string, summary: string, files: Record<string, string>) {
  const group = `${kind.replaceAll(" ", "-")}-${Bun.hash
    .crc32(summary.replace(/[0-9a-f]/gi, ""))
    .toString(16)
    .padStart(8, "0")}`;
  const name = `${group}/${Math.floor(Math.log2(Math.max(1, Object.values(files)[0].length)))}`;
  if (existsSync(join(finds, name))) return;
  mkdirSync(join(finds, name), { recursive: true });
  for (const [file, text] of Object.entries(files))
    writeFileSync(
      join(finds, name, file),
      /^(program|neighbors)/.test(file) ? text : text.slice(0, 64 << 10),
      "latin1",
    );
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
  await build(folder, texts.length, extension, texts.length);
  if (!existsSync(join(folder, "batch"))) return undefined;
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

/**
 * The programs in an executable that is built without --aot. What differs from `bun run` there in the same way belongs to executables as such.
 * Each program is a group of its own: that build makes one module of a group, and a program that cannot be part of a module would fail its neighbors.
 * Leaves out the programs that the build refuses.
 */
async function runInOrdinaryExecutable(indexes: number[], texts: string[], extension: string) {
  const folder = join(work, `ordinary-${process.pid}`);
  const results = new Map<number, Ended>();
  let left = indexes;
  while (left.length) {
    layOut(
      folder,
      left.map(index => texts[index]),
      extension,
      1,
    );
    const { refused } = await build(folder, left.length, extension, 1, []);
    if (existsSync(join(folder, "batch"))) {
      const positions = left.map((_, position) => position);
      const ran = await run("ordinary", [join(folder, "batch")], folder, extension, 1, positions, milliseconds * 20);
      left.forEach((index, position) => results.set(index, ran.get(position)!));
      break;
    }
    if (refused.size === 0) break;
    left = left.filter((_, position) => !refused.has(position));
  }
  rmSync(folder, { recursive: true, force: true });
  return results;
}

/** Whether what `bun run` prints for the one program in `folder` changes with the size of the stack. An executable's frames have other sizes. */
async function printsTheDepthOfTheStack(folder: string, extension: string) {
  const outputs: string[] = [];
  for (const kilobytes of [8192, 2048]) {
    const command = ["sh", "-c", `ulimit -s ${kilobytes}; exec "$0" run "$1"`, bun, `./programs/0${extension}`];
    outputs.push(removeDetailsOfErrors((await spawn("stack", command, folder, plainEnv, 30)).stdout));
  }
  return outputs[0] !== outputs[1];
}

/** Whether what the executable of the one program in `folder` prints changes when it is built without the text of its functions. */
async function printsFromTheTextOfFunctions(folder: string, extension: string) {
  const outputs: string[] = [];
  for (const more of [[], ["--no-compile-function-source"]]) {
    await build(folder, 1, extension, 1, ["--aot", ...buildFlags, ...more]);
    const ran = await run("text", [join(folder, "batch")], folder, extension, 1, [0], milliseconds * 20);
    outputs.push(removeDetailsOfErrors(ran.get(0)!.stdout));
  }
  return outputs[0] !== outputs[1];
}

/** Whether `bun run` prints what the executable printed once `this` of the module is `undefined` there too. Lays the changed program out in `folder`. */
async function agreesWithUndefinedAsThisOfTheModule(
  folder: string,
  extension: string,
  text: string,
  { stdout }: Ended,
) {
  layOut(folder, [withUndefinedAsThisOfTheModule(text)], extension, 1);
  const ran = await spawn("this", [bun, "run", `./programs/0${extension}`], folder, plainEnv, 30);
  return removeDetailsOfErrors(ran.stdout) === removeDetailsOfErrors(stdout);
}

/** `ended` with what the one program in `folder` writes to stderr as an executable of its own. A Worker reports the first of several errors. */
async function withErrorsOfItsOwnExecutable(folder: string, extension: string, ended: Ended): Promise<Ended> {
  const own = join(folder, "own");
  await spawn(
    "own-build",
    [bun, "build", "--compile", "--aot", ...buildFlags, `./programs/0${extension}`, "--outfile", own],
    folder,
    {},
    120,
  );
  if (!existsSync(own)) return ended;
  const ran = await spawn("own", ["sh", "-c", `ulimit -f ${maxBlocksWritten}; exec "$0"`, own], folder, {}, 30);
  rmSync(own, { force: true });
  return { ...ended, stderr: ended.stderr + ran.stderr.slice(0, 64 << 10) };
}

/** Whether the executable stopped at a name that `bun run` doesn't know either. `bun run` removes an unused read of some names. */
async function stoppedAtANameThatDoesNotExist(folder: string, { stderr }: Ended) {
  const name = /ReferenceError: ([\w$]+) is not defined/.exec(stderr)?.[1];
  if (!name) return false;
  writeFileSync(join(folder, "name.js"), `console.log(typeof ${name});`);
  return (await spawn("name", [bun, "run", "./name.js"], folder, plainEnv, 30)).stdout === "undefined\n";
}

/**
 * Whether the executable read a variable before its declaration ran, in an expression that nothing uses. `bun run` removes such an expression.
 * Builds the one program in `folder` again from the text that `bun run` makes of it, and compares that executable with `bun run`.
 */
async function stoppedAtAnUnusedReadBeforeTheDeclaration(
  folder: string,
  extension: string,
  text: string,
  compiled: Ended,
  reference: Ended,
) {
  const mentions = ({ stdout, stderr }: Ended) => (stdout + stderr).split(/ReferenceError|before initialization/).length;
  if (mentions(compiled) <= mentions(reference)) return false;
  layOut(folder, [text], extension, 1);
  const rewritten = await spawn("rewrite", [bun, "build", "--no-bundle", `./programs/0${extension}`], folder, {}, 30);
  if (rewritten.exitCode !== 0) return false;
  const otherFiles = /^\/\/ @filename: [^]*/m.exec(text)?.[0] ?? "";
  const asJavaScript = extension.replace("t", "j");
  layOut(folder, [rewritten.stdout + otherFiles], asJavaScript, 1);
  await build(folder, 1, asJavaScript, 1);
  if (!existsSync(join(folder, "batch"))) return false;
  const ran = await run("rewritten", [join(folder, "batch")], folder, asJavaScript, 1, [0], milliseconds * 20);
  return agree(ran.get(0)!, reference);
}

/**
 * Whether the two runs print the same but for the names of functions that the program declares in blocks.
 * `bun run` makes a variable with a function expression of such a declaration, and the function has no name of its own then.
 */
async function agreesButForFunctionsDeclaredInBlocks(
  folder: string,
  extension: string,
  text: string,
  compiled: Ended,
  reference: Ended,
) {
  layOut(folder, [text], extension, 1);
  const rewritten = await spawn("rewrite", [bun, "build", "--no-bundle", `./programs/0${extension}`], folder, {}, 30);
  const names = [...rewritten.stdout.matchAll(/\blet ([\w$]+) = (?:async )?function\b/g)]
    .map(([, name]) => name.replaceAll("$", "\\$"))
    .filter(name => new RegExp(`\\bfunction\\*? ?${name}\\b`).test(text));
  if (names.length === 0 || compiled.end !== reference.end) return false;
  const withoutThem = (output: string) =>
    removeDetailsOfErrors(output).replace(new RegExp(`\\b(?:${names.join("|")})\\b ?`, "g"), "");
  return withoutThem(compiled.stdout) === withoutThem(reference.stdout);
}

/** `[key]: value` in an object literal. Not `[key: string]: value` in a type. */
const computedKeyOfAValue = /(?<=[{,]\s*|^\s*)\[(?![\w$]+\??: )((?:[^\[\]\n]|\[[^\[\]\n]*\])+)\](?=: )/gm;
const withKeysConvertedBeforeValues = (text: string) =>
  text.replace(computedKeyOfAValue, "[Reflect.ownKeys({ [$1]: 0 })[0]]");
/** Whether `bun run` prints what the executable printed once it converts each computed key to a property key before it evaluates the value beside it. Lays the changed program out in `folder`. */
async function agreesWithKeysConvertedBeforeValues(folder: string, extension: string, text: string, { stdout }: Ended) {
  layOut(folder, [withKeysConvertedBeforeValues(text)], extension, 1);
  const ran = await spawn("keys", [bun, "run", `./programs/0${extension}`], folder, plainEnv, 30);
  return removeDetailsOfErrors(ran.stdout) === removeDetailsOfErrors(stdout);
}

/** Whether `bun run` stopped at an object literal that nothing uses, because one of its computed keys is a symbol. */
function stoppedAtAnUnusedLiteral(text: string, { stderr }: Ended) {
  const line = /Cannot convert a symbol to a string\n\s+at .*programs[\\/]\d+\.[a-z]+:(\d+):/.exec(stderr)?.[1];
  return line !== undefined && /^\s*\(\{/.test(text.split("\n")[Number(line) - 1] ?? "");
}

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

  // The programs that the compiler refuses leave, and so does one that it stops at. The rest is built again.
  let writesToBuiltins = new Set<number>();
  for (;;) {
    layOut(folder, texts, extension, groupSize);
    const secondsBefore = spent.build?.cpuSeconds ?? 0;
    const { refused, stopped, ...built } = await build(folder, texts.length, extension, groupSize);
    writesToBuiltins = built.writesToBuiltins;
    if (stopped || refused.size) {
      add("builds that made no executable");
      add("processor seconds in them", Math.round(spent.build.cpuSeconds - secondsBefore));
    }
    if (stopped) {
      const first = (stopped.culprit ?? 0) - ((stopped.culprit ?? 0) % groupSize);
      const group = stopped.culprit === undefined ? texts : texts.slice(first, first + groupSize);
      keepFind("build-stopped", stopped.reason, {
        ["program" + extension]: stopped.culprit === undefined ? "" : texts[stopped.culprit],
        "programs.txt": group.map((text, offset) => `// ---- ${offset}\n${text}`).join("\n"),
        "report.txt": `${stopped.reason}\n${bun} build --compile --aot ${buildFlags.join(" ")}\nprograms.txt holds the group, and the program is number ${(stopped.culprit ?? 0) - first} in it\n`,
        "compiler.stderr": stopped.stderr,
      });
      add("stopped the build");
      if (stopped.culprit === undefined) {
        add("in a build that stopped and named no program", texts.length);
        texts = [];
        break;
      }
      refused.add(stopped.culprit);
    }
    if (refused.size === 0) break;
    add("refused", refused.size - (stopped ? 1 : 0));
    texts = texts.filter((_, index) => !refused.has(index));
  }
  const all = texts.map((_, index) => index);
  const runCompiled = (indexes: number[], limit: number) =>
    run("compiled", [join(folder, "batch")], folder, extension, groupSize, indexes, limit);
  const runPlain = (indexes: number[], limit: number) =>
    run("plain", [bun, "run", "./" + runner], folder, extension, groupSize, indexes, limit, plainEnv);
  // Both wait more than they compute, so they run at once. The pair that decides runs one after the other.
  const [compiled, plain] = await Promise.all([runCompiled(all, milliseconds), runPlain(all, milliseconds)]);
  const differing = all.filter(index => !agree(compiled.get(index)!, plain.get(index)!));
  add("same", all.length - differing.length);

  // A difference counts when a second pair of runs, with more time, shows it again.
  const [compiledAgain, plainAgain] = [
    await runCompiled(differing, milliseconds * 20),
    await runPlain(differing, milliseconds * 20),
  ];
  const ordinary = await runInOrdinaryExecutable(differing, texts, extension);
  let isolated = 0;
  for (const index of differing) {
    const [first, second, reference, referenceAgain] = [
      compiled.get(index)!,
      compiledAgain.get(index)!,
      plain.get(index)!,
      plainAgain.get(index)!,
    ];
    const inOrdinary = ordinary.get(index);
    const says = (message: string) => second.stderr.includes(message) || second.stdout.includes(message);
    const showsFunctionText = !hidesFunctionText && /function|=>|class /.test(referenceAgain.stdout + second.stdout);
    let kind = referenceAgain.end.startsWith("the process ended") && !reservedTooManyAddresses(referenceAgain)
      ? "bun-run-signal"
      : isLimit(referenceAgain) || reservedTooManyAddresses(referenceAgain)
        ? "neither finished"
        : !isLimit(reference) && !agree(reference, referenceAgain)
          ? "bun run is unsteady"
          : agree(second, referenceAgain)
            ? isLimit(first) || isLimit(reference)
              ? "same with more time"
              : "unsteady"
            : second.end.startsWith("the process ended")
              ? "signal"
              : documentedMessages.some(says) ||
                  (!isLimit(second) && referenceAgain.stderr.includes("Maximum call stack size exceeded")) ||
                  documentedNames.some(name => texts[index].includes(name)) ||
                  setsThePrototypeOfABuiltIn.test(texts[index]) ||
                  deletesTheLengthOfAString.test(texts[index]) ||
                  deletesACharacterOfAString.test(texts[index]) ||
                  (second.end === referenceAgain.end &&
                    withNullAsUndefined(second.stdout) === withNullAsUndefined(referenceAgain.stdout) &&
                    readsThisOfTheModule(texts[index])) ||
                  (second.end === referenceAgain.end &&
                    withoutNamesOfFunctions(second.stdout) === withoutNamesOfFunctions(referenceAgain.stdout) &&
                    hasALiteralAsComputedKey.test(texts[index])) ||
                  writesToBuiltins.has(index)
                ? "documented difference"
                : referenceAgain.stdout === "" &&
                    refusalsOfBunRun.some(message => referenceAgain.stderr.includes(message))
                  ? "bun run refuses the file"
                  : inOrdinary && agree(second, inOrdinary) && classOfError(second) === classOfError(inOrdinary)
                    ? "as an executable without --aot"
                    : showsFunctionText || agreeButForLayout(second, referenceAgain)
                      ? "function text"
                      : second.end === referenceAgain.end && definesAnAccessorTwice(texts[index])
                        ? "an accessor defined twice"
                        : isLimit(second)
                          ? "limit"
                          : second.end !== referenceAgain.end
                            ? "exit-code"
                            : "stdout";
    // A build warns about the first write to a built-in that it meets, so the build of a group names one program of several.
    if (["limit", "exit-code", "stdout"].includes(kind)) {
      const alone = join(work, `alone-${process.pid}`);
      layOut(alone, [texts[index]], extension, 1);
      const said = await withErrorsOfItsOwnExecutable(alone, extension, second);
      if ((await build(alone, 1, extension, 1)).writesToBuiltins.size) kind = "documented difference";
      else if (await printsTheDepthOfTheStack(alone, extension)) kind = "documented difference";
      else if (
        stoppedAtAnUnusedLiteral(texts[index], referenceAgain) ||
        (!referenceAgain.stderr.includes("ReferenceError") && (await stoppedAtANameThatDoesNotExist(alone, said)))
      )
        kind = "documented difference";
      else if (!hidesFunctionText && (await printsFromTheTextOfFunctions(alone, extension))) kind = "function text";
      else if (
        readsThisOfTheModule(texts[index]) &&
        (await agreesWithUndefinedAsThisOfTheModule(alone, extension, texts[index], second))
      )
        kind = "documented difference";
      else if (
        withKeysConvertedBeforeValues(texts[index]) !== texts[index] &&
        (await agreesWithKeysConvertedBeforeValues(alone, extension, texts[index], second))
      )
        kind = "documented difference";
      else if (await stoppedAtAnUnusedReadBeforeTheDeclaration(alone, extension, texts[index], said, referenceAgain))
        kind = "documented difference";
      else if (await agreesButForFunctionsDeclaredInBlocks(alone, extension, texts[index], second, referenceAgain))
        kind = "documented difference";
      rmSync(alone, { recursive: true, force: true });
    }
    add(kind);
    if (!["bun-run-signal", "unsteady", "signal", "limit", "exit-code", "stdout", ...alsoKept].includes(kind)) continue;
    // What the process wrote last, in front of the report that starts with a line of "=", tells one end by a signal from another.
    const lastWords = kind === "signal" ? (/([^\n]*)\n={20,}\n/.exec(second.stderr)?.[1] ?? "") : "";
    const summary = `compiled: ${second.end}${lastWords && " | " + lastWords}\nbun run:  ${referenceAgain.end}\n${firstDifference(second.stdout, referenceAgain.stdout)}`;
    let where = "not tried alone";
    let enough: number[] = [];
    if (kind !== "unsteady" && kind !== "bun-run-signal" && !alsoKept.includes(kind) && isolated++ < maxFindsIsolated) {
      const subset = join(work, `subset-${process.pid}`);
      where = (await differsAmong(subset, [texts[index]], extension, 0))
        ? "differs alone too"
        : "DIFFERS ONLY AMONG NEIGHBORS";
      if (where !== "differs alone too") {
        // Halves the neighbors while the difference stays.
        const first = index - (index % groupSize);
        let neighbors = all.slice(first, first + groupSize).filter(other => other !== index);
        const among = (others: number[]) =>
          differsAmong(subset, [texts[index], ...others.map(other => texts[other])], extension, 0);
        const everyNeighbor = neighbors;
        while (neighbors.length > 1) {
          const halves = [neighbors.slice(0, neighbors.length >> 1), neighbors.slice(neighbors.length >> 1)];
          let kept: number[] | undefined;
          for (const half of halves) if (!kept && (await among(half))) kept = half;
          if (!kept) break;
          neighbors = kept;
        }
        where += `: ${neighbors.length} of them are enough, and neighbors.txt holds them`;
        if (neighbors === everyNeighbor && !(await among(neighbors))) {
          where = "differs neither alone nor in a second build with the same neighbors, which neighbors.txt holds";
          counts[kind]--;
          add((kind = "unsteady"));
        }
        enough = neighbors;
      }
      rmSync(subset, { recursive: true, force: true });
    }
    const stoppedBefore = [...(second.stoppedBefore ?? []), ...(referenceAgain.stoppedBefore ?? [])];
    keepFind(kind, summary, {
      ["program" + extension]: texts[index],
      ...(stoppedBefore.length && {
        "stopped-before.txt": stoppedBefore
          .map(other => `// ---- stopped by the runner earlier in the process\n${texts[other]}`)
          .join("\n"),
      }),
      ...(enough.length && {
        "neighbors.txt": enough.map(other => `// ---- neighbor\n${texts[other]}`).join("\n"),
      }),
      ...((kind === "unsteady" || alsoKept.includes(kind)) && {
        "first-compiled.stdout": first.stdout,
        "first-bun-run.stdout": reference.stdout,
      }),
      "report.txt": `${kind}, one of ${texts.length} programs in groups of ${groupSize}\n${bun} build --compile --aot ${buildFlags.join(" ")}\n${summary}without --aot: ${inOrdinary?.end ?? "that build refuses it"}\n${where}\n`,
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
