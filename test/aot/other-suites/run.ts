// Other people's test suites as programs for `bun build --compile --aot`: JavaScriptCore's own tests (JSTests), test262, the conformance suite of the language, and Node's own tests.
// The question is not whether a test passes. It is whether the compiled program does what plain Bun does with the same file. So a test that fails under both is the same, and
// a test that the engine is known to fail says as much about the compiler as one that passes.
//
//   bun test/aot/other-suites/run.ts jsc <WebKit>/JSTests                 7,500 tests: stress, es6, mozilla, ChakraCore, microbenchmarks, complex
//   bun test/aot/other-suites/run.ts test262 <test262>                    53,000 tests: a checkout of tc39/test262, or JSTests/test262 of WebKit
//   bun test/aot/other-suites/run.ts node test/js/node/test               3,700 tests: `parallel` and `sequential`. The library modules (node:http, stream, net ..) are compiled code in an executable: this is their suite
//     --bun <path>          the Bun under test: it runs the file, builds it, and is what the executable is made of (default: the Bun that runs this script)
//     --reference <path>    the Bun whose plain run is the reference (default: the Bun under test), for example the last release
//     --plain               nothing is built: the Bun under test runs the file too. With --reference: what this branch has changed for every program, compiled or not
//     --jobs <n>            tests at a time (default: one per core)
//     --only <expression>   the tests whose path in the suite matches the regular expression
//     --flags "<flags>"     more flags for every build, for example --aot-validate
//     --known <file>        lines `<kind> <test>: ..` of an earlier run: what stands there is counted and not printed
//     --out <file>          one line for every test, the same ones too
//
// One line for each test that is not the same, then the totals:
//   DIES       the executable ends by a signal and plain Bun does not
//   STOP       a validating build or a sanitizer stopped the executable
//   DIFFERS    another exit code, or another kind of error in the first line that names one
//   REFUSED    plain Bun runs the file, the build fails
//   COMPILER   the build ends by a signal, a panic or an internal error
// Counted and not printed:
//   LOCK       the test changes a built-in object, which an executable refuses, and the executable does what the text of the test does in a realm that is locked the same way:
//              one program built with --aot reads the file of the test and runs it as text. What does something else there is a DIFFERS, "not by the lock".
//              NOBODY READS THE REST: a test that the build refuses for the lock, a module, which no text can stand in for, and a text that loads other files, as every test of Node
//              loads its harness: an executable loads no file that it does not hold. The totals count them apart
//   BETTER     plain Bun fails and the executable ends well
//   ITSELF     (node) the test starts process.execPath or reads its own file, and fails: an executable starts itself, and does not hold its source.
//              A second start leaves a mark, so a helper of the harness that starts process.execPath for the test counts too, and so does a test that then waits until its time is up
//   OUTSIDE    (node) the test loads a file under a path that is made at run time, a fixture as a Worker for one, and the executable says that it does not hold the file
import { availableParallelism, tmpdir } from "node:os";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const [suite, root, ...rest] = process.argv.slice(2);
const option = (name: string) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
if ((suite !== "jsc" && suite !== "test262" && suite !== "node") || !root || !existsSync(root)) {
  console.error("usage: bun test/aot/other-suites/run.ts jsc|test262|node <folder of the suite> [--bun <path>] [--reference <path>] [--plain] [--jobs <n>] [--only <expression>] [--flags <flags>] [--known <file>] [--out <file>]");
  process.exit(2);
}
const only = option("--only") ? new RegExp(option("--only")!) : undefined;
const jobs = Number(option("--jobs")) || availableParallelism();
const flags = option("--flags")?.split(" ").filter(flag => flag) ?? [];
const work = mkdtempSync(join(tmpdir(), "aot-other-suites-"));
process.on("exit", () => rmSync(work, { recursive: true, force: true }));
// The Bun under test may be replaced by a build while this runs.
const bun = join(work, "bun");
cpSync(option("--bun") ?? process.execPath, bun);
const reference = option("--reference") ?? bun;
const isPlain = rest.includes("--plain");

const filesBelow = (folder: string) => (readdirSync(folder, { recursive: true, withFileTypes: true }) as import("node:fs").Dirent[]).filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name)).sort();
// Some tests hold bytes that are no UTF-8.
const read = (path: string) => readFileSync(path, "latin1");
function write(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "latin1");
}

type Test = { name: string; path: string; ownText: string };

// What the `jsc` shell defines for its tests, as far as a program can stand in for it.
const shell = `var testLoopCount = 1000, wasmTestLoopCount = 1000; var print = console.log, debug = console.log, printErr = console.error; var noInline = function () {}, neverInlineFunction = noInline, noDFG = noInline, noFTL = noInline, noOSRExitFuzzing = noInline, optimizeNextInvocation = noInline, ensureArrayStorage = function (a) { return a; }, OSRExit = noInline, failNextNewCodeBlock = noInline, setJITEnabled = noInline;
var gc = function () { Bun.gc(true); }, fullGC = gc, edenGC = function () { Bun.gc(false); }, forceGCSlowPaths = noInline, gcHeapSize = function () { return 0; }, releaseWeakRefs = noInline, isFinalTier = function () { return true; }, numberOfDFGCompiles = function () { return 0; }, dfgTrue = function () { return false; }, ftlTrue = function () { return false; }, isInt32 = function (v) { return (v | 0) === v; }, jscStack = function () { return ""; }, effectful42 = function () { return 42; }, makeMasquerader = undefined, quit = function () { process.exit(0); }, drainMicrotasks = require("bun:jsc").drainMicrotasks, preciseTime = function () { return 0; }, currentCPUTime = function () { return 0; }, describe = function () { return ""; }, describeArray = describe, hasCustomProperties = function () { return false; }, transferArrayBuffer = function (b) { structuredClone(b, { transfer: [b] }); }, is32BitPlatform = function () { return false; }, asyncTestStart = noInline, asyncTestPassed = noInline, sleepSeconds = noInline, checkModuleSyntax = undefined, platformSupportsSamplingProfiler = function () { return false; };
`;
// Tests that load other files, ask the shell for a realm, an agent or the inside of a JIT, or are skipped by their own first lines.
const needsTheShell = /\bload\(|\$vm\b|\bcreateGlobalObject\b|\$262|\$\.agent|\brunString\b|\bloadString\b|\breadFile\b|\breadline\b|\bWScript\b|\/\/@ skip\b|\bevalScript\b|\bwaitFor|\bsamplingProfiler|\bgenerateHeapSnapshot|\bsetTimeout\b.*\$|\bimport\s*\(|\bstartTest\(|\bwriteHeaderToLog\b|\bTestCase\b/;

function testsOfJavaScriptCore(): Test[] {
  const tests: Test[] = [];
  for (const top of ["stress", "es6", "mozilla", "ChakraCore/test", "microbenchmarks", "complex"]) {
    if (!existsSync(join(root, top))) continue;
    for (const path of filesBelow(join(root, top))) {
      const name = relative(root, path).replaceAll("\\", "/");
      if (!name.endsWith(".js") || name.split("/").at(-1)!.startsWith("._") || (only && !only.test(name))) continue;
      const text = read(path);
      if (needsTheShell.test(text)) continue;
      const isModule = /^\s*(import\s|export\s)/m.test(text) || text.includes('//@ runDefault("-m")');
      const program = join(work, "tests", name.slice(0, -3) + (isModule ? ".mjs" : ".cjs"));
      write(program, (isModule ? shell.replace('require("bun:jsc").drainMicrotasks', '(await import("bun:jsc")).drainMicrotasks') : shell) + text);
      tests.push({ name, path: program, ownText: text });
    }
  }
  return tests;
}

function testsOfTest262(): Test[] {
  const tests: Test[] = [];
  const harness = new Map<string, string>();
  const harnessFile = (name: string) => harness.get(name) ?? harness.set(name, read(join(root, "harness", name))).get(name)!;
  for (const path of filesBelow(join(root, "test"))) {
    const name = relative(join(root, "test"), path).replaceAll("\\", "/");
    if (!name.endsWith(".js") || name.split("/").at(-1)!.startsWith("._")) continue;
    // Module tests find their fixtures beside them.
    if (name.endsWith("_FIXTURE.js")) {
      write(join(work, "tests", name), read(path));
      continue;
    }
    if (only && !only.test(name)) continue;
    const text = read(path);
    const description = /\/\*---(.*?)---\*\//s.exec(text)?.[1] ?? "";
    const listed = (key: string) => {
      const inBrackets = new RegExp(key + ":\\s*\\[(.*?)\\]", "s").exec(description);
      if (inBrackets) return inBrackets[1].split(",").map(word => word.trim()).filter(word => word);
      const inLines = new RegExp(key + ":\\s*\\n((?:\\s+-\\s*\\S+\\n)+)").exec(description);
      return inLines ? [...inLines[1].matchAll(/-\s*(\S+)/g)].map(match => match[1]) : [];
    };
    const testFlags = listed("flags");
    const inFront = "var print = console.log;\n" + harnessFile("assert.js") + harnessFile("sta.js") + (testFlags.includes("async") ? harnessFile("doneprintHandle.js") : "") + listed("includes").map(harnessFile).join("");
    const program = join(work, "tests", name.slice(0, -3) + (testFlags.includes("module") ? ".mjs" : ".cjs"));
    write(program, testFlags.includes("raw") ? text : (testFlags.includes("onlyStrict") ? '"use strict";\n' : "") + inFront + "\n" + text);
    tests.push({ name, path: program, ownText: text });
  }
  return tests;
}

// An executable that starts process.execPath starts itself: the whole test again, and that one the next, without end. The copy of the harness ends the second one at once,
// and leaves a file beside the temporary folder of the run, which the test may empty.
const markOfASecondStart = ".started-itself";
const endsTheSecondOfItself = `if (globalThis.process.argv[1] && /^(\\/\\$bunfs\\/|B:[\\\\/]~BUN)/.test(globalThis.process.argv[1])) { if (globalThis.process.env.STARTED_BY_ITSELF) { try { require("node:fs").writeFileSync(globalThis.process.env.STARTED_BY_ITSELF, ""); } catch {} console.error("the executable started itself"); globalThis.process.exit(86); } globalThis.process.env.STARTED_BY_ITSELF = (globalThis.process.env.NODE_TEST_DIR ?? "") + "${markOfASecondStart}"; }\n`;

function testsOfNode(): Test[] {
  const copy = join(work, "tests");
  cpSync(root, copy, { recursive: true });
  const change = (file: string, how: (text: string) => string) => writeFileSync(join(copy, file), how(readFileSync(join(copy, file), "utf8")));
  // __dirname of an executable's module is inside the executable. The fixtures are not.
  change("common/fixtures.js", text => text.replace(/^const fixturesDir = .*$/m, () => `const fixturesDir = ${JSON.stringify(join(copy, "fixtures"))};`));
  // A getter of the harness reads the harness's own file, and index.mjs touches it in every module test.
  change("common/index.js", text => endsTheSecondOfItself + text.replaceAll("fs.readFileSync(__filename)", () => `fs.readFileSync(${JSON.stringify(join(copy, "common", "index.js"))})`));
  return ["parallel", "sequential"]
    .flatMap(folder => readdirSync(join(copy, folder)).filter(file => /\.m?js$/.test(file)).sort().map(file => `${folder}/${file}`))
    .filter(name => !only || only.test(name))
    .map(name => ({ name, path: join(copy, name), ownText: read(join(copy, name)) }));
}

// NODE_SKIP_FLAG_CHECK: Node's harness reads the test's own file for the flags it wants. A test that needs a flag then fails under plain Bun too.
const environment = { ...process.env, BUN_ENABLE_CRASH_REPORTING: "0", DO_NOT_TRACK: "1", NO_COLOR: "1", BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1", TZ: "Etc/UTC", NODE_SKIP_FLAG_CHECK: "1" };
const secondsOfARun = suite === "node" ? 60 : 20;

async function spawned(cmd: string[], cwd: string, seconds: number, temporary?: string) {
  if (temporary) mkdirSync(temporary, { recursive: true });
  const child = Bun.spawn({ cmd, cwd, env: temporary ? { ...environment, NODE_TEST_DIR: temporary } : environment, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: seconds * 1000, killSignal: "SIGKILL" });
  const [stdout, stderr] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { said: stdout + stderr, code: child.signalCode ?? child.exitCode ?? -1 };
}

// The first line that names an error, without the paths and without what quotes the source: plain Bun and an executable word those parts differently.
function firstError(said: string) {
  const line = said.split("\n").filter(line => !/^ *\d+ \|/.test(line)).find(line => /Test262Error|Error|AOT validation|panic|AddressSanitizer|Test262:AsyncTest(Complete|Failure)/.test(line)) ?? "";
  if (line.startsWith("Test262Error {")) return "Test262Error: " + (/^ *message: (.*)$/m.exec(said)?.[1] ?? "").slice(0, 120);
  return line.replace(/^\[STD(ERR|OUT)\] /, "").replace(/\/[^ :]*\//g, "").replace(/\(evaluating .*/, "").replace(/\. \(In .*/, "").slice(0, 110);
}
const kindOf = (error: string) => error.split(":")[0];

const builtIn = "(Object|Array|Function|Boolean|Number|String|RegExp|Date|Error|[A-Za-z]+Error|Symbol|Promise|Map|Set|WeakMap|WeakSet|WeakRef|ArrayBuffer|SharedArrayBuffer|DataView|[A-Za-z0-9]+Array|TypedArray|TA|Iterator|Math|JSON|Reflect|Atomics|Intl(\\.[A-Za-z]+)?|Temporal(\\.[A-Za-z]+)?|BigInt|Proxy|FinalizationRegistry|DisposableStack|AsyncDisposableStack|GeneratorFunction|AsyncFunction|Generator|[A-Za-z]*Prototype|[A-Za-z]*IteratorPrototype|globalThis)";
const changesABuiltIn = new RegExp(
  `\\b${builtIn}(\\.prototype)?(\\.[A-Za-z_$][A-Za-z0-9_$]*|\\[[^\\]]+\\])+ *(=[^=]|\\+\\+|--|[-+*/]=)|delete +${builtIn}(\\.prototype)?[.\\[]` +
    `|(defineProperty|defineProperties|setPrototypeOf|freeze|seal|preventExtensions|assign|__defineGetter__|__defineSetter__)\\( *${builtIn}(\\.prototype)?( *[,)]|\\.[a-zA-Z]+ *,)|${builtIn}(\\.prototype)?\\.__proto__ *=`,
);
const saysTheLock =
  /read-only in a compiled executable|immutable properties|object that is not extensible|descriptor should (not )?be (writable|configurable)|to have (writable|configurable)|should be (writable|configurable)|Cannot (delete|redefine) property|Unable to delete property|Attempting to change|is immutable|Cannot set prototype of/;

// The realm of an executable is locked whatever it runs. This one runs the file that it is handed as the body of a CommonJS module, which is what the file is for plain Bun and for the build.
// It names what the stand-in for the `jsc` shell asks for by name, so that the image has it.
const hostOfTexts = `const { readFileSync } = require("node:fs");
const { dirname } = require("node:path");
require("bun:jsc");
const path = process.argv[2];
const made = { exports: {} };
new Function("exports", "require", "module", "__filename", "__dirname", readFileSync(path, "utf8")).call(made.exports, made.exports, require, made, path, dirname(path));
`;
let hostIsBuilt: Promise<string> | undefined;
function buildHostOfTexts() {
  return (hostIsBuilt ??= (async () => {
    write(join(work, "host", "host.cjs"), hostOfTexts);
    const build = await spawned([bun, "build", "--compile", "--aot", ...flags, "host.cjs", "--outfile", "host"], join(work, "host"), 300);
    if (build.code !== 0) throw new Error("the program that runs a test as text does not build: " + build.said.slice(0, 400));
    return join(work, "host", "host");
  })());
}

const saysTheFileIsOutside = /Cannot load '[^']+': it isn't in this executable, which only runs code that was compiled into it/;

async function judgeByTheLock(name: string, path: string, why: string, compiled: { said: string; code: number | string }) {
  if (path.endsWith(".mjs")) return `LOCK ${name}: unread, a module: ${why}`;
  const asTextInALockedRealm = await spawned([await buildHostOfTexts(), path], dirname(path), 20);
  if (saysTheFileIsOutside.test(asTextInALockedRealm.said)) return `LOCK ${name}: unread, the text loads other files: ${why}`;
  const [theirs, ours] = [firstError(asTextInALockedRealm.said), firstError(compiled.said)];
  if (asTextInALockedRealm.code === compiled.code && kindOf(theirs) === kindOf(ours)) return `LOCK ${name}: ${why}`;
  return `DIFFERS ${name}: not by the lock: as text in a locked realm | compiled: exit ${asTextInALockedRealm.code} | ${compiled.code}: ${theirs} | ${ours}`;
}

async function judge({ name, path, ownText }: Test, index: number): Promise<string> {
  const cwd = dirname(path);
  const executable = join(work, "executables", String(index));
  // Each run of a test of Node has a temporary folder of its own.
  const temporary = (run: string) => (suite === "node" ? join(work, "temporary", index + run) : undefined);
  const plain = await spawned([reference, "run", path], cwd, secondsOfARun, temporary("plain"));
  if (isPlain) {
    const ours = await spawned([bun, "run", path], cwd, secondsOfARun, temporary("ours"));
    if (typeof ours.code === "string" && ours.code !== plain.code) return `DIES ${name}: ${ours.code} (the reference ${plain.code}): ${ours.said.split("\n").find(line => line.includes("panic"))?.slice(0, 90) ?? ""}`;
    if (plain.code === ours.code && kindOf(firstError(plain.said)) === kindOf(firstError(ours.said))) return `same ${name}`;
    if (plain.code !== 0 && ours.code === 0) return `BETTER ${name}: the reference: ${firstError(plain.said)}`;
    return `DIFFERS ${name}: exit ${plain.code} | ${ours.code}: ${firstError(plain.said)} | ${firstError(ours.said)}`;
  }
  const build = await spawned([bun, "build", "--compile", "--aot", "--aot-threads=1", ...flags, path, "--outfile", executable], cwd, 120);
  try {
    if (build.code !== 0) {
      const broke = /panic|internal compiler error|AddressSanitizer/.exec(build.said);
      if (typeof build.code === "string" || broke) return `COMPILER ${name}: ${build.code} (plain ${plain.code}): ${build.said.split("\n").find(line => /panic|internal compiler error|AddressSanitizer/.test(line))?.slice(0, 150) ?? ""}`;
      if (plain.code !== 0) return `same-refused ${name}`;
      if (build.said.includes("TS100014")) return `LOCK ${name}: unread, refused at the build`;
      return `REFUSED ${name}: ${build.said.split("\n").find(line => /error/i.test(line))?.slice(0, 130) ?? ""}`;
    }
    const compiled = await spawned([executable], cwd, secondsOfARun, temporary("compiled"));
    // What a test has started and left behind runs the same file.
    if (suite === "node" && process.platform !== "win32") Bun.spawnSync(["pkill", "-9", "-f", "^" + executable]);
    const [theirs, ours] = [firstError(plain.said), firstError(compiled.said)];
    const startedItself = suite === "node" && plain.code === 0 && existsSync(temporary("compiled") + markOfASecondStart);
    if (/AddressSanitizer|AOT validation/.test(compiled.said)) return `STOP ${name}: ${ours}`;
    if (startedItself && compiled.code === "SIGKILL") return `ITSELF ${name}: its time was up: ${ours}`;
    if (typeof compiled.code === "string" && compiled.code !== plain.code) return `DIES ${name}: ${compiled.code} (plain ${plain.code}): ${compiled.said.split("\n").find(line => line.includes("panic"))?.slice(0, 90) ?? ""}`;
    if (plain.code === compiled.code && kindOf(theirs) === kindOf(ours)) return `same ${name}`;
    if (startedItself || (suite === "node" && plain.code === 0 && /execPath|fork\(|argv\[0\]|__filename/.test(ownText))) return `ITSELF ${name}: ${compiled.code}: ${ours}`;
    if (suite === "node" && plain.code === 0 && saysTheFileIsOutside.test(compiled.said)) return `OUTSIDE ${name}: ${compiled.code}: ${ours}`;
    if (plain.code === 0 && saysTheLock.test(compiled.said)) return await judgeByTheLock(name, path, ours, compiled);
    if (plain.code === 0 && changesABuiltIn.test(ownText)) return await judgeByTheLock(name, path, "the test changes a built-in: " + ours, compiled);
    if (plain.code !== 0 && compiled.code === 0) return `BETTER ${name}: plain: ${theirs}`;
    return `DIFFERS ${name}: exit ${plain.code} | ${compiled.code}: ${theirs} | ${ours}`;
  } finally {
    rmSync(executable, { force: true });
    if (suite === "node") for (const run of ["plain", "ours", "compiled"]) for (const path of [temporary(run)!, temporary(run) + markOfASecondStart]) rmSync(path, { recursive: true, force: true });
  }
}

const tests = suite === "jsc" ? testsOfJavaScriptCore() : suite === "test262" ? testsOfTest262() : testsOfNode();
mkdirSync(join(work, "executables"), { recursive: true });
const known = new Set(option("--known") ? readFileSync(option("--known")!, "utf8").split("\n").map(line => /^[A-Z]+ ([^:]+):/.exec(line)?.[1]) : []);
const lines: string[] = [];
let next = 0;
await Promise.all(
  Array.from({ length: jobs }, async () => {
    while (next < tests.length) {
      const index = next++;
      const line = await judge(tests[index], index);
      lines.push(line);
      if (!/^(same|LOCK|BETTER|ITSELF|OUTSIDE)/.test(line) && !known.has(tests[index].name)) console.log(line);
    }
  }),
);
if (option("--out")) writeFileSync(option("--out")!, lines.sort().join("\n") + "\n");
const count = (kind: string) => lines.filter(line => line.startsWith(kind + " ")).length;
console.log(
  `TOTAL ${tests.length}: same ${count("same")}, neither loads nor builds ${count("same-refused")}, by the lock of the built-ins ${count("LOCK")} (unread ${lines.filter(line => /^LOCK [^:]+: unread/.test(line)).length}), plain Bun fails and the executable ends well ${count("BETTER")}, ` +
    (suite === "node" ? `starts itself or reads its own file ${count("ITSELF")}, loads a file that the executable does not hold ${count("OUTSIDE")}, ` : "") +
    `DIES ${count("DIES")}, STOP ${count("STOP")}, DIFFERS ${count("DIFFERS")}, REFUSED ${count("REFUSED")}, COMPILER ${count("COMPILER")}`,
);
