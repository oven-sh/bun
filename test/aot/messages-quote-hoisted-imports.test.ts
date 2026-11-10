// vi.mock() is hoisted, and the imports of its file become loads. A message quotes an imported name as the file writes it.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const messages = {
  "named(1, 2)": "TypeError: named is not a function. (In 'named(1, 2)', 'named' is 2)",
  "renamed()": "TypeError: renamed is not a function. (In 'renamed()', 'renamed' is 3)",
  "initial.missing(1)":
    "TypeError: initial.missing is not a function. (In 'initial.missing(1)', 'initial.missing' is undefined)",
  "all.missing(1)": "TypeError: all.missing is not a function. (In 'all.missing(1)', 'all.missing' is undefined)",
  "all.nested.missing()":
    "TypeError: all.nested.missing is not a function. (In 'all.nested.missing()', 'all.nested.missing' is undefined)",
  "new named(1)": "TypeError: 2 is not a constructor (evaluating 'new named(1)')",
  "new all.missing(1)": "TypeError: undefined is not a constructor (evaluating 'new all.missing(1)')",
  "nothing.member": "TypeError: undefined is not an object (evaluating 'nothing.member')",
  "nothing.member()": "TypeError: undefined is not an object (evaluating 'nothing.member')",
  "nested.missing({ named })":
    "TypeError: nested.missing is not a function. (In 'nested.missing({ named })', 'nested.missing' is undefined)",
  "null.call(named)": "TypeError: null is not an object (evaluating 'null.call')",
  "5 in named": "TypeError: named is not an Object. (evaluating '5 in named')",
};

test.concurrent.each(["a.test.ts", "a.test.js"])(
  "%s",
  async name => {
    const asks = Object.keys(messages).map(line => `() => ${line}`);
    using dir = tempDir("aot-hoisted-imports-in-messages", {
      "package.json": `{ "name": "p", "type": "module" }`,
      "mocked.js": `export const mocked = 1;\n`,
      "values.js": `export const named = [2][0];
export const other = [3][0];
export const nested = { [named]: 1 };
export const nothing = [][0];
export default { [named]: 1 };
`,
      [name]: `import { expect, test, vi } from "bun:test";
import initial, { named, other as renamed, nested, nothing } from "./values.js";
import * as all from "./values.js";
import { mocked } from "./mocked.js";
vi.mock("./mocked.js", () => ({ mocked: 2 }));
const asks = [
  ${asks.join(",\n  ")},
];
test("t", () => {
  expect(mocked).toBe(2);
  for (const ask of asks) {
    try {
      ask();
      console.error("OUT nothing is thrown");
    } catch (error) {
      console.error("OUT " + String(error));
    }
  }
});
`,
    });
    await using run = Bun.spawn({
      cmd: [bunExe(), "test", "--aot"],
      cwd: String(dir),
      env: bunEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
    const said = stderr.split("\n").filter(line => line.startsWith("OUT "));
    expect(said.map(line => line.slice("OUT ".length))).toEqual(Object.values(messages));
    expect(exitCode).toBe(0);
  },
  120_000,
);
