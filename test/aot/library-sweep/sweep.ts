// What Bun's library makes or holds, used from the test files of a layered `bun test --aot`, each use alone in a test file, which is a program of its own there.
//
//   bun test/aot/library-sweep/sweep.ts [--bun <path>] [--handed] [--only <regular expression>] [--jobs 24] [--words <words>] [--shown 60] [--keep <folder>]
//
// In a layered run the program of a test file is built over others, and the objects of the library were made by the lowest of them. Where the compiler takes such an object for one
// that this program's own copy of the library made, the program reads it by the wrong layout: it ends in a fault, throws a TypeError, or answers wrongly without a sound.
//
// WHAT ELSE A PROGRAM USES HIDES SUCH A FAULT. `process.stdout.write("")` alone in a test file ended the process; with node:stream used beside it, it was right. Sixty uses a file saw
// nothing; the uses of one object in one file saw 1 wrong answer; one use a file saw 135. console.* hides some forms too. So there is one use a file, and no file prints: the binary
// runs the files without --aot, twice, what it printed both times goes into each file as what is expected, and the printing goes out.
//
// Without --handed: ./spelled.mjs, what a program can spell, some 8,100 uses. With it: ./handed.mjs, what the library hands to callbacks, some 8,500 uses of 123 scenarios.
// A sweep is as many small builds: some 4,500 seconds of CPU. --only takes the uses whose text (--handed: whose scenario's name) matches.
// --words goes to BUN_DEBUG_TEST_AOT_WORDS, by default TestRunLayers:2,TestRunPartFiles:1. --keep leaves the project and the logs in the folder.
//
// It lists each use that ended the process and each that answered otherwise than without --aot, counts them by root, and exits with 1 if there is any. An error that an event brings
// later is counted against whichever test runs then, so a failure without "Expected:" is listed apart and not counted. `ShadowRealm` is not there in compiled code, as documented.
//
// A SWEEP THAT HAS NEVER BEEN RED SAYS LITTLE. The spelled uses were: 3 faults and 135 wrong answers on process.stdout, stderr and stdin. The handed ones never were.
// AND PERHAPS NEVER CAN BE, FOR THIS KIND OF FAULT. Measured on another fault of the kind, a read of the global object, with one other thing beside it in each of 21 files: it was hidden by
// USING anything imported from another program (a source file, a package, a module of the library; by import, require or import()), by an import for its effects, and by handing globalThis on.
// It was not hidden by `in`, a store, a delete, hasOwn, keys, a computed read, expect, timers, process.env, eval, new Function, an import that is not used, or a type.
// Every scenario of ./handed.mjs uses a module of the library to get its object. So a clean --handed sweep does not clear what the library hands out, and what can show such a fault is a
// program that uses globals alone, which is what ./spelled.mjs has for every global.
import { spawnSync } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { parseArgs } from "util";

const { values: options } = parseArgs({
  options: {
    bun: { type: "string", default: process.execPath },
    handed: { type: "boolean", default: false },
    only: { type: "string" },
    jobs: { type: "string", default: "24" },
    words: { type: "string", default: "TestRunLayers:2,TestRunPartFiles:1" },
    shown: { type: "string", default: "60" },
    keep: { type: "string" },
  },
});
const bun = resolve(options.bun);
const work = options.keep ? resolve(options.keep) : mkdtempSync(join(tmpdir(), "library-sweep-"));
const project = join(work, "sweep");
mkdirSync(join(work, "tmp"), { recursive: true });
const env: Record<string, string | undefined> = {
  ...process.env,
  NO_COLOR: "1",
  BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
  BUN_TMPDIR: join(work, "tmp"),
  BUN_ENABLE_CRASH_REPORTING: "0",
  DO_NOT_TRACK: "1",
  ONLY_MATCH: options.only,
  BUN_DEBUG_TEST_AOT_WORDS: undefined,
};

function runTests(log: string, flags: string[], words?: string): string {
  const started = performance.now();
  const { stdout, stderr } = spawnSync(bun, ["test", "--isolate", `--parallel=${options.jobs}`, ...flags], {
    cwd: project,
    env: { ...env, BUN_DEBUG_TEST_AOT_WORDS: words },
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1 << 30,
    encoding: "latin1",
  });
  const text = stdout + "\n" + stderr;
  writeFileSync(join(work, log), text);
  console.log(`${log}: ${((performance.now() - started) / 1000).toFixed(1)} s`);
  return text;
}
const printedBy = (text: string) =>
  new Map(
    text
      .split("\n")
      .filter(line => line.startsWith("RESULT|"))
      .map(line => line.split("|"))
      .map(parts => [parts.slice(2, -1).join("|"), parts.at(-1)!]),
  );

const generated = spawnSync(bun, [join(import.meta.dir, options.handed ? "handed.mjs" : "spelled.mjs"), project], { env, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
console.log(generated.stdout.split("\n").filter(line => / uses in |nothing at the place|the probe of/.test(line)).join("\n"));
const idsOfFile = new Map<string, string[]>();
for (const line of readFileSync(join(project, "manifest.tsv"), "utf8").split("\n").filter(Boolean)) {
  const [file, , id] = line.split("\t");
  idsOfFile.set(file, [...(idsOfFile.get(file) ?? []), id]);
}

// What the binary prints without --aot, the same twice, is what each file expects from here on.
const first = printedBy(runTests("reference.log", []));
const second = printedBy(runTests("reference-again.log", []));
let leftOut = 0;
for (const [file, ids] of idsOfFile) {
  const path = join(project, "test", `here-${file}.test.ts`);
  if (!ids.every(id => first.has(id) && first.get(id) === second.get(id))) {
    rmSync(path, { force: true });
    idsOfFile.delete(file);
    leftOut++;
    continue;
  }
  const expected = JSON.stringify(Object.fromEntries(ids.map(id => [id, first.get(id)])));
  const text = readFileSync(path, "utf8")
    .replace(`import { test } from "bun:test";`, `import { expect, test } from "bun:test";\nconst EXPECTED = ${expected};`)
    .replace(`console.log("RESULT|" + WHERE + "|" + id + "|" + text);`, `expect(text).toBe(EXPECTED[id]);`)
    .replace(/console\.log\("RESULT\|here\|" \+ ("(?:[^"\\]|\\.)*") \+ "\|" \+ seen\);/, (_, id) => `expect(seen).toBe(EXPECTED[${id}]);`);
  if (text.includes(`console.log("RESULT`)) throw new Error(`${path} still prints`);
  writeFileSync(path, text);
}
console.log(`${idsOfFile.size} files expect what was printed, ${leftOut} left out: printed nothing, or not the same twice`);

// The lines of the workers come in no fixed order. An expectation that is not met names its file in the frames under it, so it is found by that, wherever it stands.
function outcomeOf(text: string) {
  const died = new Map([...text.matchAll(/here-(\d+)\.test\.ts \(worker crashed: (\w+)\)/g)].map(match => [match[1], match[2]]));
  const failed = new Map([...text.matchAll(/^Expected: (.*)\nReceived: (.*)\n(?:.*\n){0,3}?\s+at .*here-(\d+)\.test\.ts:/gm)].map(match => [match[3], `${match[1]} > ${match[2]}`]));
  let passed = 0;
  const blocks = text.split(/^test\/here-(\d+)\.test\.ts:$/m);
  for (let at = 1; at < blocks.length; at += 2) {
    if (/^\(pass\)/m.test(blocks[at + 1])) passed++;
    else if (/^\(fail\)/m.test(blocks[at + 1]) && !failed.has(blocks[at])) failed.set(blocks[at], "");
  }
  return { passed, failed, died };
}
const reference = outcomeOf(runTests("reference-expecting.log", []));
const compiled = outcomeOf(runTests("compiled.log", ["--aot"], options.words));
for (const file of [...reference.failed.keys(), ...compiled.died.keys()]) compiled.failed.delete(file);
const stray = [...compiled.failed].filter(([, what]) => !what).map(([file]) => file);
for (const file of stray) compiled.failed.delete(file);

const idOf = (file: string) => idsOfFile.get(file)?.[0] ?? file;
console.log(`compiled: ${compiled.passed} pass, ${compiled.failed.size} answer otherwise, ${compiled.died.size} end the process; without --aot ${reference.passed} pass, ${reference.failed.size} fail and are left out`);
for (const [file, signal] of compiled.died) console.log(`DIES\t${signal}\t${idOf(file)}`);
for (const [file, what] of [...compiled.failed].slice(0, Number(options.shown))) console.log(`UNLIKE\t${idOf(file)}\t${what}`);
if (stray.length) console.log(`errors that came later, not counted: ${stray.length}: ${stray.slice(0, 8).map(idOf).join(" . ")}`);
const byRoot = new Map<string, number>();
for (const file of [...compiled.failed.keys(), ...compiled.died.keys()]) {
  const id = idOf(file);
  const root = options.handed ? id.split(": ")[0] : (id.match(/^(?:new |inspect |\[\.\.\.)*([\w$]+(?:\.[\w$]+)?)/)?.[1] ?? id);
  byRoot.set(root, (byRoot.get(root) ?? 0) + 1);
}
if (byRoot.size) console.log("by root: " + [...byRoot].sort((a, b) => b[1] - a[1]).map(([root, count]) => `${root} ${count}`).join(" . "));
if (options.keep) console.log(`kept: ${work}`);
else rmSync(work, { recursive: true, force: true });
process.exit(compiled.failed.size || compiled.died.size ? 1 : 0);
