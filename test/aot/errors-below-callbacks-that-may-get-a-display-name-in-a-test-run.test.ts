import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { afterAll } from "./harness/default-timeout";
import { run } from "./harness/run";
import { runsWholeGrids } from "./harness/ways";
import { beforeAll, test } from "./supported";

// One statement like `render.displayName = name` in react's memo(), on a function that nobody follows, means that any callback that is made more than once may be the one
// that was renamed: a frame of such a callback is named by the function object that ran in it. A stack that nobody has read yet is kept as return addresses, with those
// function objects beside them. In a test run the test file, the application and a package are programs of their own, and one stack goes through all three.
// What the stack says has to stay what plain Bun says, whenever the names are given.
const files: Record<string, string> = {
  "package.json": `{ "name": "p", "type": "module" }
`,
  "tsconfig.json": `{}
`,
  "node_modules/shows/package.json": `{ "name": "shows", "version": "1.0.0", "type": "module", "main": "index.js" }
`,
  "node_modules/shows/index.js": `const handedBack = new Function("f", "return f");
export const shownAs = (render, name) => { handedBack(render).displayName = name; return render; };
export const asWritten = render => { delete handedBack(render).displayName; return render; };
export const handedOn = render => handedBack(render);
export const forEachOf = (list, each) => {
  const inThePackage = function inThePackage(item) { return [...each(item)]; };
  return { found: list.flatMap(handedBack(inThePackage)), inThePackage };
};
`,
  "src/work.js": `import { forEachOf, handedOn } from "shows";
const step = (path, visit) => visit(path) + 1;
export function work(list, probe, k) {
  const visit = handedOn(function visit(path) { return probe(path + k) + 1; });
  const each = function each(path) { return [step(path, visit)]; };
  const { found, inThePackage } = forEachOf(list, each);
  return { result: found.length, visit, each, inThePackage };
}
`,
  "a.test.js": `import { expect, test } from "bun:test";
import fs from "node:fs";
import { asWritten, shownAs } from "shows";
import { work } from "./src/work.js";

shownAs(function component() {}, "Shown");
const names = error => String(error.stack).split("\\n").slice(1).map(line => line.trim().replace(/^at /, "").replace(/ ?\\(.*\\)$/, "")).filter(name => name && !/[\\/\\\\]/.test(name)).join(" < ");
const say = (label, error) => console.log("SEEN " + label + " | " + names(error));
let kept = [];
const keep = error => { if (kept.length < 5) kept.push(error); return 1; };
const probes = {
  made: path => keep(new Error(path)),
  missing: path => { try { return fs.statSync(path).size; } catch (error) { return keep(error); } },
  thrown: path => { try { return path.nothing.here; } catch (error) { return keep(error); } },
};
const list = ["/nowhere/a", "/nowhere/b", "/nowhere/c", "/nowhere/d", "/nowhere/e"];

test("names", () => {
  for (const [label, probe] of Object.entries(probes)) {
    kept = [];
    let first;
    let sum = 0;
    for (let i = 0; i < 40; i++) { const made = work(list, probe, i & 3); sum += made.result; first ??= made; }
    console.log("SEEN " + label + " " + sum);
    say(label + ", as written", kept[0]);
    // The stacks were taken before the names were given and are read behind them.
    shownAs(first.each, "for each");
    say(label + ", one of the application named", kept[1]);
    shownAs(first.inThePackage, "in a package");
    say(label + ", one of the package too", kept[2]);
    shownAs(probe, "probed by " + label);
    say(label + ", one of the test file too", kept[3]);
    asWritten(first.each);
    Bun.gc(true);
    say(label + ", one as written again, behind a collection", kept[4]);
    // Other function objects of the same functions ran in these.
    kept = [];
    work(list, probe, 0);
    say(label + ", others", kept[0]);
  }
  const limit = Error.stackTraceLimit;
  for (const n of [1, 2, 3, 4, 5, 6, 100]) {
    Error.stackTraceLimit = n;
    kept = [];
    const { each, inThePackage } = work(list, path => keep(new Error(path)), 0);
    shownAs(each, "for each"); shownAs(inThePackage, "in a package");
    say("at most " + n, kept[0]);
  }
  Error.stackTraceLimit = limit;
  expect(1).toBe(1);
});
`,
  "b.test.js": `import { expect, test } from "bun:test";
test("another file, so that the run has pieces", () => expect(1).toBe(1));
`,
};

async function seenIn(directory: string, words: string | undefined, flag?: string, more: Record<string, string> = {}) {
  const flags = flag ? [flag] : [];
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, ...more } : bunEnv;
  const { stdout, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  return { seen: stdout.split("\n").filter(line => line.startsWith("SEEN ")), exitCode };
}

let dir: ReturnType<typeof tempDir> | undefined;
let plain: Awaited<ReturnType<typeof seenIn>>;
beforeAll(async () => {
  dir = tempDir("aot-errors-below-callbacks-that-may-get-a-display-name", files);
  plain = await seenIn(String(dir), undefined);
});
afterAll(() => dir?.[Symbol.dispose]());

test("plain Bun names the callbacks of a stack through three programs", () => {
  expect(plain.exitCode).toBe(0);
  expect(plain.seen.length).toBe(28);
  expect(plain.seen[1]).toContain("made < visit < step < each < inThePackage < forEachOf < work");
  expect(plain.seen[4]).toContain("probed by made < visit < step < for each < in a package < forEachOf < work");
});

// The run time holds every trace that it keeps as return addresses against the frames listed one by one.
const validating = { BUN_JSC_validateAOTRuntime: "1" };
const forms: [string, string, Record<string, string>][] = [
  ["one program", "TestRunLayers:0", {}],
  ["one layer", "TestRunLayers:1,TestRunPartFiles:1", {}],
  ["two layers", "TestRunLayers:2,TestRunPartFiles:1", {}],
  ["one program that validates", "TestRunLayers:0", validating],
  ["one layer that validates", "TestRunLayers:1,TestRunPartFiles:1", validating],
  ["two layers that validate", "TestRunLayers:2,TestRunPartFiles:1", validating],
];
// A layer costs ten times the one program. In front of a merge: what a user's flags build, and the form that was wrong, under the run time's own check.
const inFrontOfAMerge = ["one program", "two layers that validate"];
test.each(forms.filter(([form]) => runsWholeGrids || inFrontOfAMerge.includes(form)))(
  "a stack through three programs names its callbacks as plain Bun does: %s",
  async (_, words, more) => {
    expect(await seenIn(String(dir), words, "--aot", more)).toEqual(plain);
  },
);
