import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const uses = `
  const Comparator = require("./comparator"), Range = require("./range");
  console.log("in the cycle range.js saw a", Range.saw);
  try { console.log("holds:", new Range().holds(new Comparator()), new Comparator().test(new Range())); } catch (error) { console.log("throws", error.name); }
  const named = require("./named-a");
  console.log("named:", named.first, named.second);
  console.log("whole:", JSON.stringify(require("./whole-a")));
  console.log("twice:", JSON.stringify(require("./twice-a")));
`;
const files = {
  "comparator.js": `class Comparator { test(range) { return range instanceof Range; } }\nmodule.exports = Comparator;\nconst Range = require("./range");\n`,
  "range.js": `class Range { holds(comparator) { return comparator instanceof Comparator; } }\nmodule.exports = Range;\nconst Comparator = require("./comparator");\nRange.saw = typeof Comparator;\n`,
  "named-a.js": `exports.first = 1;\nconst b = require("./named-b");\nexports.second = b.sawFirst;\n`,
  "named-b.js": `const a = require("./named-a");\nexports.sawFirst = a.first;\n`,
  "whole-a.js": `exports.first = 1;\nconst b = require("./whole-b");\nexports.second = b.saw;\n`,
  "whole-b.js": `exports.saw = JSON.stringify(require("./whole-a"));\n`,
  "twice-a.js": `module.exports = { stage: 1 };\nconst early = require("./twice-b");\nmodule.exports = { stage: 2, early };\n`,
  "twice-b.js": `module.exports = require("./twice-a").stage;\n`,
  "deletes-itself.js": `delete require.cache[require.resolve(__filename)];\nmodule.exports = 1;\n`,
  "unread.cjs": uses,
  "read.cjs": `Object.keys(require.cache);\n${uses}`,
  "deleted.cjs": `require("./deletes-itself");\n${uses}`,
  "cycle.test.js": `
    const { test } = require("node:test"), assert = require("node:assert");
    require("./deletes-itself");
    const Comparator = require("./comparator"), Range = require("./range");
    test("a cycle", () => { assert.strictEqual(Range.saw, "function"); assert.ok(new Range().holds(new Comparator())); });
  `,
};
const compiledOnly = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };

async function run(cwd: string, args: string[], env: Record<string, string | undefined>) {
  const { stdout, stderr, exitCode } = await runCommand([bunExe(), ...args], cwd, env);
  return { stdout, stderr, exitCode };
}

test.concurrent.each(["unread.cjs", "read.cjs", "deleted.cjs"])(
  "bun run --aot %s: a module in a cycle sees what the other has assigned to module.exports so far",
  async entry => {
    using dir = tempDir("aot-commonjs-cycle", files);
    const plain = await run(String(dir), ["run", `./${entry}`], bunEnv);
    expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(plain.stdout).toContain("in the cycle range.js saw a function\nholds: true true\n");
    expect(await run(String(dir), ["run", "--debug-aot", `./${entry}`], compiledOnly)).toEqual(plain);
  },
  120_000,
);

test.concurrent(
  "bun test --aot: a cycle that is loaded behind a module that deletes itself from require.cache",
  async () => {
    using dir = tempDir("aot-commonjs-cycle", files);
    const { stderr, exitCode } = await run(String(dir), ["test", "--debug-aot", "./cycle.test.js"], compiledOnly);
    expect(stderr).toContain(" 1 pass");
    expect(exitCode).toBe(0);
  },
  120_000,
);
