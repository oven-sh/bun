// `if (feature("EXTRA")) spyOn(sums, "total")`, with `feature` of `bun:bundle` and `bun test --feature=EXTRA`. The look through the test files, which tells each layer of a large run which
// exports the tests above it replace, folded feature() with no feature enabled: the branch was dead for it and the spy in it was told to nobody.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { runsWholeGrids } from "./harness/ways";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const inBlock = (test: string) => `
  let under = "no spy";
  if (${test}) {
    using spy = spyOn(sums, "total").mockReturnValue("spied");
    under = read();
  }
  console.error("SEEN " + JSON.stringify([under, read()]));`;
const forms = {
  "under the feature": { flags: ["--feature=EXTRA"], body: inBlock(`feature("EXTRA")`) },
  "where the feature is off": { flags: [], body: inBlock(`!feature("EXTRA")`) },
  "behind a return where the feature is off, on a module out of a require()": {
    flags: ["--feature=EXTRA"],
    body: `
  if (!feature("EXTRA")) {
    return;
  }
  const required = require("./src/sums.js") as typeof import("./src/sums.js");
  let under;
  {
    using spy = spyOn(required, "total").mockReturnValue("spied");
    under = read();
  }
  console.error("SEEN " + JSON.stringify([under, read()]));`,
  },
};

// Over layers two of the three were wrong. There the benches run the third.
const formsOver = (layers: number) =>
  Object.entries(forms).filter(([name]) => !layers || runsWholeGrids || name !== "where the feature is off");

for (const layers of [0, 2])
  for (const [name, form] of formsOver(layers))
    test(`${name}, ${layers} layers`, async () => {
      using dir = tempDir("aot-spy-under-a-feature", {
        "package.json": `{ "name": "spy-under-a-feature", "type": "module" }`,
        "src/sums.js": `export function total(list) { let sum = 0; for (const item of list) sum += item; return sum; }\nexport function twice(x) { return x * 2; }\n`,
        "src/reader.js": `import { total, twice } from "./sums.js";\nexport const read = () => [total([1, 2, 3]), twice(4)];\n`,
        "a.test.ts": `
import { feature } from "bun:bundle";
import { test, spyOn } from "bun:test";
import * as sums from "./src/sums.js";
import { read } from "./src/reader.js";
test("a", () => {${form.body}
});
`,
        "b.test.js": `import { test } from "bun:test";\nimport { read } from "./src/reader.js";\ntest("b", () => { console.error("SEEN " + JSON.stringify(read())); });\n`,
      });
      const seenWith = async (...flags: string[]) => {
        const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: `TestRunLayers:${layers}` };
        const command = [bunExe(), "test", "--isolate", ...form.flags, ...flags];
        const { stdout, stderr, exitCode } = await run(command, String(dir), env);
        const lines = (stdout + "\n" + stderr).split("\n");
        return { seen: lines.filter(line => line.startsWith("SEEN ") || line.includes("Cannot spy")).sort(), exitCode };
      };
      const plain = await seenWith();
      expect(plain).toEqual({ seen: [`SEEN [6,8]`, `SEEN [["spied",8],[6,8]]`], exitCode: 0 });
      expect(await seenWith("--aot")).toEqual(plain);
    });
