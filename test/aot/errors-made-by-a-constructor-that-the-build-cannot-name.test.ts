import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `new Error()` where the build does not know that `Error` is the built-in one calls the engine's own constructor, like any host function. Over layers that is every
// `new Error()` of the application and of the test files. The constructor leaves its own frame out of the trace, and for that alone the error listed every frame at
// once, where an error that compiled code makes keeps the return addresses: 3.4 times the instructions, 12 times where the frames of two images alternate.
// What the trace says has to stay what plain Bun says.
const files: Record<string, string> = {
  "package.json": `{ "name": "p", "type": "module" }
`,
  "tsconfig.json": `{}
`,
  "node_modules/makes/package.json": `{ "name": "makes", "version": "1.0.0", "type": "module", "main": "index.js" }
`,
  "node_modules/makes/index.js": `export const inThePackage = (make, depth) => { const made = depth ? inThePackage(make, depth - 1) : make(); made.marked = true; return made; };
export const madeInThePackage = text => { const made = new Error(text); made.marked = true; return made; };
export const madeInATailCallOfThePackage = text => new Error(text);
export class ErrorOfThePackage extends Error { constructor(text) { super(text); this.name = "ErrorOfThePackage"; } }
`,
  "src/makes.js": `import { inThePackage } from "makes";
export const inTheApplication = (make, depth) => { const made = depth ? inThePackage(() => inTheApplication(make, depth - 1), 1) : make(); made.marked = true; return made; };
export const madeInTheApplication = text => { const made = new Error(text); made.marked = true; return made; };
export const madeInATailCallOfTheApplication = text => new Error(text);
export const byAnyConstructor = (Constructor, ...all) => { const made = new Constructor(...all); made.marked = true; return made; };
export const byACall = (Constructor, ...all) => { const made = Constructor(...all); made.marked = true; return made; };
export class ErrorOfTheApplication extends TypeError { constructor(text) { super(text); this.name = "ErrorOfTheApplication"; } }
export async function madeBehindAnAwait(make) { await null; const made = make(); made.marked = true; return made; }
export const parsedInATailCall = text => JSON.parse(text);
export const decodedInATailCall = text => decodeURIComponent(text);
`,
  "a.test.js": `import { expect, test } from "bun:test";
import { ErrorOfThePackage, inThePackage, madeInATailCallOfThePackage, madeInThePackage } from "makes";
import { byACall, byAnyConstructor, decodedInATailCall, ErrorOfTheApplication, inTheApplication, madeBehindAnAwait, madeInATailCallOfTheApplication, madeInTheApplication, parsedInATailCall } from "./src/makes.js";

const shown = error => String(error.stack).split("\\n").map(line => line.replace(/\\(?(?:file:\\/\\/)?\\/[^ ]*\\/(?=(?:node_modules|src|a\\.test))/, "(").trim()).filter(line => !/native|bun:|processTicks|unknown/.test(line)).join(" | ");
const say = (label, error) => console.log("SEEN " + label + " | " + shown(error));
class ErrorOfTheTestFile extends RangeError { constructor(text) { super(text); this.name = "ErrorOfTheTestFile"; } }
const hidden = name => globalThis[["", name].join("")];

test("traces", async () => {
  say("here", new Error("here"));
  say("in the application", madeInTheApplication("a"));
  say("in the package", madeInThePackage("p"));
  say("in a tail call of the application", madeInATailCallOfTheApplication("ta"));
  say("in a tail call of the package", inTheApplication(() => madeInATailCallOfThePackage("tp"), 1));
  say("by a constructor that is handed over", byAnyConstructor(hidden("Error"), "handed"));
  say("by a call", byACall(hidden("Error"), "called"));
  for (const name of ["TypeError", "RangeError", "SyntaxError", "EvalError", "ReferenceError", "URIError"]) say(name, byAnyConstructor(hidden(name), name));
  say("an AggregateError", byAnyConstructor(hidden("AggregateError"), [new Error("inner")], "many"));
  say("with a cause", byAnyConstructor(hidden("Error"), "outer", { cause: 1 }));
  say("by Reflect.construct", Reflect.construct(hidden("Error"), ["reflected"]));
  say("by Reflect.construct for a subclass", Reflect.construct(hidden("Error"), ["reflected"], ErrorOfTheTestFile));
  say("frames of three programs in turn", inTheApplication(() => madeInThePackage("deep"), 3));
  say("frames of three programs in turn, made here", inTheApplication(() => new Error("deep here"), 3));
  say("below the package alone", inThePackage(() => madeInTheApplication("below"), 4));
  say("a subclass of the package", new ErrorOfThePackage("sp"));
  say("a subclass of the application", new ErrorOfTheApplication("sa"));
  say("a subclass of the test file", new ErrorOfTheTestFile("st"));
  say("a subclass made elsewhere", byAnyConstructor(ErrorOfTheTestFile, "elsewhere"));
  say("a subclass below frames in turn", inTheApplication(() => new ErrorOfThePackage("turns"), 2));
  say("behind an await", await madeBehindAnAwait(() => madeInThePackage("awaited")));
  say("in a callback of a built-in", [1].map(() => madeInTheApplication("mapped"))[0]);
  say("in a getter", { get made() { return madeInTheApplication("got"); } }.made);
  const limit = Error.stackTraceLimit;
  for (const n of [0, 1, 2, 3, 100]) { Error.stackTraceLimit = n; say("at most " + n, inTheApplication(() => madeInThePackage("limited"), 2)); }
  Error.stackTraceLimit = limit;
  const kept = madeInTheApplication("kept"); Bun.gc(true); say("behind a collection", kept);
  const target = {}; Error.captureStackTrace(target); say("captureStackTrace", target);
  try { null.x; } catch (error) { say("thrown by the engine", error); }
  // Native code makes these below an operation of compiled code, with no host frame on top.
  await import("data:text/javascript,let let = 2 +").catch(error => console.log("SEEN an import of text that does not parse | " + error.name + " " + typeof error.stack));
  await madeBehindAnAwait(() => import("data:text/javascript,let let = 3 +").catch(error => error)).then(error => console.log("SEEN the same in the application | " + error.name + " " + typeof error.stack));
  try { inTheApplication(() => { throw madeInThePackage("thrown"); }, 2); } catch (error) { say("thrown and caught", error); }
  // A built-in that is called in a tail call throws. Where the engine had called the function, no frame of compiled code is left below the built-in's.
  // What such an error keeps lies where short lists have lain.
  let lists = Array.from({ length: 30000 }, (_, i) => [[i + 1], [i + 1, i + 2], [i + 1, i + 2, i + 3]]); lists = null; Bun.gc(true);
  for (const [fails, text] of [[parsedInATailCall, "{"], [decodedInATailCall, "%"]]) {
    const all = []; for (let i = 0; i < 300; i++) all.push(await Promise.resolve(text).then(fails).catch(error => error));
    Bun.gc(true); const [kept] = all; expect(new Set(all.map(shown)).size).toBe(1); say("thrown by a built-in in a tail call, below a job", kept);
    try { [text].map(fails); } catch (error) { say("the same below a callback", error); }
    try { Reflect.apply(fails, undefined, [text]); } catch (error) { say("the same below Reflect.apply", error); }
  }
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

test("an error made by the engine's own constructor says what plain Bun says", async () => {
  using dir = tempDir("aot-errors-by-a-constructor-nobody-names", files);
  const plain = await seenIn(String(dir), undefined);
  expect(plain.exitCode).toBe(0);
  expect(plain.seen.length).toBe(45);
  expect(plain.seen[1]).toContain("at madeInTheApplication (src/makes.js:3:");
  expect(await seenIn(String(dir), "TestRunLayers:0", "--aot")).toEqual(plain);
  expect(await seenIn(String(dir), "TestRunLayers:1,TestRunPartFiles:1", "--aot")).toEqual(plain);
  expect(await seenIn(String(dir), "TestRunLayers:2,TestRunPartFiles:1", "--aot")).toEqual(plain);
  // The run time holds every trace that it keeps as return addresses against the frames listed one by one.
  expect(await seenIn(String(dir), "TestRunLayers:0", "--aot", { BUN_JSC_validateAOTRuntime: "1" })).toEqual(plain);
  expect(
    await seenIn(String(dir), "TestRunLayers:2,TestRunPartFiles:1", "--aot", { BUN_JSC_validateAOTRuntime: "1" }),
  ).toEqual(plain);
}, 360_000);
