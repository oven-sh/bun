// react-dom's development build asks `typeof jest !== "undefined"`. `bun test` hands every file the names of the test runner, so for the build that file held `jest`, which has `spyOn`, and
// did something else with it than read a member: it counted as a file that lets a spy go where nobody sees what it is called with. One such file in a run, and every export of every module
// whose namespace object goes anywhere could be replaced under any name.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const questions = {
  "typeof": { asks: `typeof jest !== "undefined"`, letsItGo: false },
  "a comparison": { asks: `jest !== undefined`, letsItGo: false },
  "not": { asks: `!!jest`, letsItGo: false },
  "it keeps the object": { asks: `[jest].length === 1`, letsItGo: true },
};

for (const [name, { asks, letsItGo }] of Object.entries(questions))
  test(name, async () => {
    using dir = tempDir("aot-asks-whether-jest-is-there", {
      "package.json": `{ "name": "asks-whether-jest-is-there", "type": "module" }`,
      "node_modules/asks/package.json": `{ "name": "asks", "version": "1.0.0", "main": "index.js" }`,
      "node_modules/asks/index.js": `var jestIsDefined = ${asks};\nexports.isTested = function () { return jestIsDefined; };\n`,
      "lib.js": `export function total(list) { let sum = 0; for (const item of list) sum += item; return sum; }\nexport function twice(x) { return x * 2; }\n`,
      "reader.js": `import { total, twice } from "./lib.js";\nexport const read = () => [total([1, 2, 3]), twice(4)];\n`,
      "a.test.js": `
import { test, spyOn } from "bun:test";
import { isTested } from "asks";
import * as lib from "./lib.js";
import { read } from "./reader.js";
const held = { lib };
test("t", () => {
  const spy = spyOn(held.lib, "total").mockReturnValue("spied");
  const under = read();
  spy.mockRestore();
  console.error("SEEN " + JSON.stringify([isTested(), under, read()]));
});
`,
    });
    const seenWith = async (...flags: string[]) => {
      const env = { ...bunEnv, BUN_JSC_logAOTPhaseTimes: "1" };
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), env);
      const lines = (stdout + "\n" + stderr).split("\n");
      return {
        seen: lines.filter(line => line.startsWith("SEEN ") || line.includes("Cannot spy")),
        letsItGo: lines.some(line =>
          line.includes("asks/index.js lets spyOn go where nobody sees what it is called with"),
        ),
        mocksOutOfSight: lines.some(line => /asks\/index\.js \| mocks a module that it does not spell true/.test(line)),
        underAnyName: [
          ...new Set(lines.flatMap(line => /\| a spy under any name (true|false) \|/.exec(line)?.[1] ?? [])),
        ].sort(),
        exitCode,
      };
    };
    const seen = [`SEEN [true,["spied",8],[6,8]]`];
    const nothing = { letsItGo: false, mocksOutOfSight: false, underAnyName: [] };
    expect(await seenWith()).toEqual({ seen, ...nothing, exitCode: 0 });
    const underAnyName = letsItGo ? ["false", "true"] : ["false"];
    expect(await seenWith("--aot")).toEqual({ seen, letsItGo, mocksOutOfSight: letsItGo, underAnyName, exitCode: 0 });
  });
