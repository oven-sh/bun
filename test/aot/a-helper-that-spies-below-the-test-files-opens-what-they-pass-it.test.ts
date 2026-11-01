// A large run is built in layers: the files that the test files share are compiled once, below them. A helper among those, `track(object, name) { return spyOn(object, name); }`, has its
// callers above, where the build of its layer does not look, so it counted as a spy under any name: every export of every module whose namespace object goes anywhere could be replaced.
// The scan of the test files reads all the callers before any layer is built. It tells each layer the names that they pass and the modules whose objects they pass.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

for (const layers of [2, 3])
  test(`${layers} layers`, async () => {
    const testFile = (name: string, spied: string) => `
import { test } from "bun:test";
import { track } from "./helpers/track.js";
import * as sums from "./src/sums.js";
import { read } from "./src/reader.js";
test(${JSON.stringify(name)}, () => {
  const spy = track(sums, ${JSON.stringify(spied)}).mockReturnValue("spied");
  const under = read();
  spy.mockRestore();
  console.error("SEEN " + JSON.stringify([${JSON.stringify(name)}, under, read()]));
});
`;
    using dir = tempDir("aot-helper-below-the-test-files", {
      "package.json": `{ "name": "helper-below-the-test-files", "type": "module" }`,
      "helpers/track.js": `import { spyOn } from "bun:test";\nexport function track(object, name) { return spyOn(object, name); }\n`,
      "src/sums.js": `export function total(list) { let sum = 0; for (const item of list) sum += item; return sum; }\nexport function twice(x) { return x * 2; }\nexport function thrice(x) { return x * 3; }\n`,
      "src/reader.js": `import { total, twice, thrice } from "./sums.js";\nexport const read = () => [total([1, 2, 3]), twice(4), thrice(5)];\n`,
      "a.test.js": testFile("a", "total"),
      "b.test.js": testFile("b", "twice"),
    });
    const seenWith = async (...flags: string[]) => {
      const env = { ...bunEnv, BUN_JSC_logAOTPhaseTimes: "1", BUN_DEBUG_TEST_AOT_WORDS: `TestRunLayers:${layers}` };
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], String(dir), env);
      const lines = (stdout + "\n" + stderr).split("\n");
      return {
        seen: lines.filter(line => line.startsWith("SEEN ") || line.includes("Cannot spy")).sort(),
        // Bun's own node:test hands its spy on, in the layer of the library.
        underAnyName:
          lines.filter(line => line.includes("| a spy under any name true |")).length -
          lines.filter(line => line.includes("/node/test.ts lets spyOn go where nobody sees")).length,
        says: lines.some(line => line.includes("| a spy under any name false |")),
        exitCode,
      };
    };
    const seen = [`SEEN ["a",["spied",8,15],[6,8,15]]`, `SEEN ["b",[6,"spied",15],[6,8,15]]`];
    expect(await seenWith()).toEqual({ seen, underAnyName: 0, says: false, exitCode: 0 });
    expect(await seenWith("--aot")).toEqual({ seen, underAnyName: 0, says: true, exitCode: 0 });
  });
