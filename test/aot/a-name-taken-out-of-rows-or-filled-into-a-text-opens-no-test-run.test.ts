// Four more ways in which real suites spell the name of a spy, each of which left a whole test run open to a spy under any name.
// `for (const [kind, name] of ROWS) spyOn(object, name)`: what a pattern takes out of a list or an object is somewhere in it.
// spyOn(object, `log${kind}`): a text with holes is each text that its holes can be filled to.
// `export * from "./helper"`: a text that goes to a file that exports a helper again goes to the helper.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const spy = `spyOn(holders.math, name).mockReturnValue("spied"); say(name + " " + read()); mock.restore();`;
const both = ["logHalf spied,5,4", "logAdd 2,spied,4"];
const ways: Record<string, { text: string; seen: string[]; anyName: boolean }> = {
  "rows taken apart by for-of": {
    text: `test("t", () => { for (const [kind, name] of [["half", "logHalf"], ["add", "logAdd"]]) { ${spy} } });`,
    seen: both,
    anyName: false,
  },
  "rows under a name": {
    text: `const ROWS = [["half", "logHalf"], ["add", "logAdd"]]; test("t", () => { for (const [kind, name] of ROWS) { ${spy} } });`,
    seen: both,
    anyName: false,
  },
  "rows that are objects": {
    text: `test("t", () => { for (const { name } of [{ name: "logHalf" }, { name: "logAdd" }]) { ${spy} } });`,
    seen: both,
    anyName: false,
  },
  "through a function of the file": {
    text: `const lay = name => { ${spy} }; test("t", () => { for (const [name, code] of [["logHalf", 1], ["logAdd", 2]]) lay(name); });`,
    seen: both,
    anyName: false,
  },
  "one row taken apart": {
    text: `test("t", () => { const [name, code] = ["logHalf", 1]; ${spy} });`,
    seen: both.slice(0, 1),
    anyName: false,
  },
  "a parameter that is a pattern": {
    text: `test.each([{ name: "logHalf" }, { name: "logAdd" }])("$name", ({ name }) => { ${spy} });`,
    seen: both,
    anyName: false,
  },
  "a template with a hole": {
    text: `test("t", () => { ["Half", "Add"].forEach(kind => { const name = \`log\${kind}\`; ${spy} }); });`,
    seen: both,
    anyName: false,
  },
  "a sum with a hole": {
    text: `test("t", () => { for (const kind of ["Half", "Add"]) { const name = "log" + kind; ${spy} } });`,
    seen: both,
    anyName: false,
  },
  "a helper behind files that export it again": {
    text: `import * as Helpers from "./helpers/index.js"; test("t", () => { Helpers.lay("logHalf"); say("logHalf " + read()); mock.restore(); Helpers.lay("logAdd"); say("logAdd " + read()); mock.restore(); });`,
    seen: both,
    anyName: false,
  },
  // Nobody spells the names: they may be any.
  "a hole that nobody spells": {
    text: `test("t", () => { for (const kind of ["half", "add"].map(it => it[0].toUpperCase() + it.slice(1))) { const name = \`log\${kind}\`; ${spy} } });`,
    seen: both,
    anyName: true,
  },
  "rows that are made": {
    text: `test("t", () => { for (const [kind, name] of ["Half", "Add"].map(it => [it, "log" + it])) { ${spy} } });`,
    seen: both,
    anyName: true,
  },
};

for (const [name, { text, seen, anyName }] of Object.entries(ways))
  test.concurrent(name, async () => {
    using dir = tempDir("aot-names-through-patterns", {
      "package.json": `{ "name": "p", "type": "module" }`,
      "math.js": `export function logHalf(n) { return n / 2; }\nexport function logAdd(n) { return n + 1; }\nexport function kept(n) { return n; }\n`,
      "holders.js": `import * as math from "./math.js";\nexport const holders = { math };\n`,
      "reader.js": `import { kept, logAdd, logHalf } from "./math.js";\nexport const read = () => [logHalf(4), logAdd(4), kept(4)].join();\n`,
      "helpers/index.js": `export * from "./lay/index.js";\n`,
      "helpers/lay/index.js": `export { lay } from "./lay.js";\n`,
      "helpers/lay/lay.js": `import { spyOn } from "bun:test";\nimport { holders } from "../../holders.js";\nexport const lay = name => spyOn(holders.math, name).mockReturnValue("spied");\n`,
      "a.test.js": `import { mock, spyOn, test } from "bun:test";\nimport { holders } from "./holders.js";\nimport { read } from "./reader.js";\nconst say = it => console.error("SEEN " + it);\n${text}\n`,
    });
    const seenWith = async (...flags: string[]) => {
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), {
        ...bunEnv,
        BUN_JSC_logAOTPhaseTimes: "1",
      });
      const lines = (stdout + "\n" + stderr).split("\n");
      return {
        seen: lines.filter(line => line.startsWith("SEEN ")).map(line => line.slice(5)),
        found: lines
          .flatMap(
            line =>
              /variables that tests may replace \d+ in .* a spy under any name (true|false)/.exec(line)?.slice(1, 2) ??
              [],
          )
          .slice(0, 1),
        exitCode,
      };
    };
    expect(await seenWith()).toEqual({ seen, found: [], exitCode: 0 });
    expect(await seenWith("--aot")).toEqual({ seen, found: [String(anyName)], exitCode: 0 });
  });
