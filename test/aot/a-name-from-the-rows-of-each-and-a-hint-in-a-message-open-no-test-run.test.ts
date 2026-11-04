// Two things that real suites write, and that left a whole test run open to a spy under any name: every export of every file could be replaced.
// `test.each([["half", 1]])("%s", (name, count) => spyOn(object, name))`: the name is a parameter of a callback. What the call in front was handed may be what the callback is called with.
// `throw new Error("write: spyOn(object, '" + name + "')")`: a hint that reads like code. An error of the language is made with it, or `console` prints it: nobody runs a message.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const spy = `spyOn(holders.math, name).mockReturnValue("spied"); say(name + " " + read()); mock.restore();`;
const hint = "`import { spyOn } from \"bun:test\"; spyOn(held, '${made}');`";
const ways: Record<string, { text: string; seen: string[]; anyName: boolean; replaceable?: number }> = {
  "the rows of test.each": { text: `test.each([["half", 1], ["add", 2]])("%s", (name, count) => { ${spy} });`, seen: ["half spied,5,4", "add 2,spied,4"], anyName: false, replaceable: 2 },
  "the second of each row": { text: `test.each([[1, "half"], [2, "add"]])("%i", (count, name) => { ${spy} });`, seen: ["half spied,5,4", "add 2,spied,4"], anyName: false, replaceable: 2 },
  "a flat list": { text: `test.each(["half", "add"])("%s", name => { ${spy} });`, seen: ["half spied,5,4", "add 2,spied,4"], anyName: false, replaceable: 2 },
  "rows under a name": { text: `const ROWS = [["half", 1], ["add", 2]]; test.each(ROWS)("%s", (name, count) => { ${spy} });`, seen: ["half spied,5,4", "add 2,spied,4"], anyName: false, replaceable: 2 },
  "describe.each": { text: `describe.each(["half", "add"])("%s", name => { test("t", () => { ${spy} }); });`, seen: ["half spied,5,4", "add 2,spied,4"], anyName: false, replaceable: 2 },
  "a function of the file answers what takes the callback": { text: `const over = list => run => list.forEach(run); test("t", () => { over(["half", "add"])(name => { ${spy} }); });`, seen: ["half spied,5,4", "add 2,spied,4"], anyName: false, replaceable: 2 },
  // Nobody spells the names: they may be any.
  "rows that are made": { text: `test.each(["ha", "ad"].map((start, at) => start + ["lf", "d"][at]))("%s", name => { ${spy} });`, seen: ["half spied,5,4", "add 2,spied,4"], anyName: true },
  "the message of an Error": { text: `test("t", () => { say(new Error(${hint}).message.length + " " + read()); });`, seen: ["54 2,5,4"], anyName: false, replaceable: 0 },
  "the message of a TypeError": { text: `test("t", () => { say(TypeError(${hint}).message.length + " " + read()); });`, seen: ["54 2,5,4"], anyName: false, replaceable: 0 },
  "printed by console": { text: `test("t", () => { console.warn(${hint}); say(read()); });`, seen: ["2,5,4"], anyName: false, replaceable: 0 },
  "a part of a longer message": { text: `test("t", () => { say(new Error("half() was called without a spy.\\n" + ${hint} + "\\n").message.length + " " + read()); });`, seen: ["88 2,5,4"], anyName: false, replaceable: 0 },
  "through a variable": { text: `test("t", () => { const text = ${hint}; console.warn(text); say(new RangeError(text).message.length + " " + read()); });`, seen: ["54 2,5,4"], anyName: false, replaceable: 0 },
  // Whoever else gets the text may run it.
  "handed to a function that nobody knows": { text: `test("t", () => { globalThis.take?.(${hint}); say(read()); });`, seen: ["2,5,4"], anyName: true },
  "the message of an error of the file's own": { text: `class Failure extends Error {} test("t", () => { say(new Failure(${hint}).message.length + " " + read()); });`, seen: ["54 2,5,4"], anyName: true },
};

for (const [name, { text, seen, anyName, replaceable }] of Object.entries(ways))
  test.concurrent(name, async () => {
    using dir = tempDir("aot-names-and-messages", {
      "package.json": `{ "name": "p", "type": "module" }`,
      "math.js": `export function half(n) { return n / 2; }\nexport function add(n) { return n + 1; }\nexport function kept(n) { return n; }\n`,
      "holders.js": `import * as math from "./math.js";\nexport const holders = { math };\n`,
      "reader.js": `import { add, half, kept } from "./math.js";\nexport const read = () => [half(4), add(4), kept(4)].join();\n`,
      "a.test.js": `import { describe, mock, spyOn, test } from "bun:test";\nimport { holders } from "./holders.js";\nimport { read } from "./reader.js";\nconst made = ["ha", "lf"].join("");\nconst say = it => console.error("SEEN " + it);\n${text}\n`,
    });
    const seenWith = async (...flags: string[]) => {
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), { ...bunEnv, BUN_JSC_logAOTPhaseTimes: "1" });
      const lines = (stdout + "\n" + stderr).split("\n");
      return {
        seen: lines.filter(line => line.startsWith("SEEN ")).map(line => line.slice(5)),
        found: lines.flatMap(line => /variables that tests may replace (\d+) in .* a spy under any name (true|false)/.exec(line)?.slice(1, 3) ?? []).slice(0, 2),
        exitCode,
      };
    };
    expect(await seenWith()).toEqual({ seen, found: [], exitCode: 0 });
    expect(await seenWith("--aot")).toEqual({ seen, found: [anyName ? expect.any(String) : String(replaceable), String(anyName)], exitCode: 0 });
  });
