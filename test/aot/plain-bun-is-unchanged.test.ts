// What Bun without --aot must not get from the compiler. Every test here passes on a Bun that has no compiler at all.
import { expect } from "bun:test";
import { test } from "./harness/declare";
import { bunEnv, bunExe, tempDir } from "harness";

// The collector reads every word of a live stack frame. A word that only a compiled or validated program writes keeps what an
// earlier call left in it, and the frames of the event loop lie at the same addresses in every turn.
test("a stream that failed is collected within a few turns of the event loop", async () => {
  using dir = tempDir("plain-bun-collects", {
    "main.js": `
      const zlib = require("zlib");
      const { releaseWeakRefs } = require("bun:jsc");
      let ref;
      function isAlive() { return ref.deref() !== undefined; }
      {
        const stream = zlib.createInflate();
        stream.end(Buffer.from("foobar"));
        stream.once("error", () => {
          let turn = 0;
          const step = () => {
            releaseWeakRefs();
            Bun.gc(true);
            if (!isAlive()) return console.log("collected");
            if (++turn > 10) return console.log("alive");
            (turn % 2 ? process.nextTick : setImmediate)(step);
          };
          setImmediate(step);
        });
        ref = new WeakRef(stream);
      }
    `,
  });
  const run = async (env: Record<string, string>) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      cwd: String(dir),
      env: { ...bunEnv, ...env },
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    return { stdout, exitCode };
  };
  const runs = await Promise.all([
    ...Array.from({ length: 4 }, () => run({ BUN_JSC_useJIT: "0" })),
    ...Array.from({ length: 4 }, () => run({})),
  ]);
  for (const result of runs) expect(result).toEqual({ stdout: "collected\n", exitCode: 0 });
}, 60_000);

test("the members of a native class come in the order of localeCompare", () => {
  const names = Object.getOwnPropertyNames(Bun.RedisClient.prototype);
  expect(names.indexOf("getbit")).toBeGreaterThan(-1);
  expect(names.indexOf("getbit")).toBeLessThan(names.indexOf("getBuffer"));
});

// `module.parent` answers from three fields of the module object, and a compiled program fills two of them in ways of its own.
test("a store into the parent of a module object is answered as before", async () => {
  using dir = tempDir("plain-bun-module-parent", {
    "main.cjs": `const Module = require("node:module");
const show = (label, m) => console.log(label, m.parent === module ? "the module" : typeof m.parent === "object" && m.parent ? JSON.stringify(m.parent) : String(m.parent));
{
  const m = new Module("x", module);
  show("made with a module:", m);
  m.parent = 7;
  show("a number is stored:", m);
  m.parent = undefined;
  show("undefined is stored:", m);
  m.parent = { stored: 1 };
  show("an object is stored:", m);
  m.parent = module;
  show("the module is stored:", m);
  m.parent = null;
  show("null is stored:", m);
}
{
  const m = new Module("x", { plain: 1 });
  show("made with a plain object:", m);
  m.parent = 7;
  show("a number is stored:", m);
  m.parent = module;
  show("the module is stored:", m);
  m.parent = 7;
  show("a number is stored again:", m);
}
{
  const m = new Module("x", module);
  console.log("deleted:", delete m.parent);
  show("behind the deletion:", m);
  console.log(Object.keys(m).includes("parent"), "parent" in m);
}
{
  const m = new Module("x");
  show("made without:", m);
  m.parent = 7;
  show("a number is stored:", m);
}
{
  show("a required file's own, read here:", require("./required.cjs"));
}
{
  require("./es.mjs");
  const m = require.cache[require.resolve("./es.mjs")];
  show("of an ES module that was required:", m);
  m.parent = 7;
  show("a number is stored:", m);
  m.parent = { stored: 1 };
  show("an object is stored:", m);
  m.parent = module;
  show("the module is stored:", m);
  m.parent = "text";
  show("a text is stored:", m);
}
{
  const m = module.children.find(child => child.id.endsWith("child.cjs")) ?? (require("./child.cjs"), module.children.find(child => child.id.endsWith("child.cjs")));
  show("of a child:", m);
  m.parent = 7;
  show("a number is stored:", m);
  console.log("deleted:", delete m.parent, "parent" in m, typeof m.parent);
}
{
  show("of the entry:", module);
  module.parent = 7;
  show("a number is stored:", module);
}
`,
    "required.cjs": `const before = module.parent === require.main;
module.parent = 7;
console.log("in a required file:", before, typeof module.parent);
module.exports = module;
`,
    "es.mjs": `export const one = 1;
`,
    "child.cjs": `exports.one = 1;
`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.cjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout.trim().split("\n")).toEqual([
    "made with a module: the module",
    "a number is stored: 7",
    "undefined is stored: undefined",
    'an object is stored: {"stored":1}',
    "the module is stored: the module",
    "null is stored: null",
    'made with a plain object: {"plain":1}',
    "a number is stored: 7",
    "the module is stored: the module",
    "a number is stored again: 7",
    "deleted: true",
    "behind the deletion: undefined",
    "false true",
    "made without: undefined",
    "a number is stored: undefined",
    "in a required file: true undefined",
    "a required file's own, read here: undefined",
    "of an ES module that was required: the module",
    "a number is stored: undefined",
    "an object is stored: undefined",
    "the module is stored: the module",
    "a text is stored: undefined",
    "of a child: the module",
    "a number is stored: undefined",
    "deleted: true true undefined",
    "of the entry: null",
    "a number is stored: null",
  ]);
  expect(exitCode).toBe(0);
});

// The general serializer refuses the 40,001st list inside a list. The quick one in front of it had no such count: only the stack stopped it, and how
// many levels fit there depends on how Bun was built. A build whose frames are small wrote a text where every other Bun throws.
test("JSON.stringify throws at 40,001 lists inside one another, however Bun was built", async () => {
  using dir = tempDir("plain-bun-deep-json", {
    "main.js": `
      function lists(levels) { let value = 1; for (let i = 0; i < levels; i++) value = [value]; return value; }
      for (const levels of [40_000, 40_001, 45_000]) {
        try {
          console.log(levels, JSON.stringify(lists(levels)).length);
        } catch (error) {
          console.log(levels, error instanceof RangeError, error.message);
        }
      }
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout.trim().split("\n")).toEqual([
    "40000 80001",
    "40001 true Maximum call stack size exceeded.",
    "45000 true Maximum call stack size exceeded.",
  ]);
  expect(exitCode).toBe(0);
}, 60_000);
