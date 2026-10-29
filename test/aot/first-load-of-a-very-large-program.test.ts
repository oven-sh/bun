// Where whole-program analysis says nothing, a program holds all of Bun's own code, and a load that lacks it is thrown away and done again.
// The first load of a very large program expects that and holds all of it from the start. Where the analysis comes to an end after all,
// the program is loaded again as if nothing had been expected. No test program is that large, so the limit is lowered.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";
import { readBuildReport } from "./harness/build-report";
import { unsupported } from "./harness/compiler";
import { withReport } from "./harness/flags";
import { run } from "./harness/run";
import { sharedBuilds } from "./harness/shared-builds";

describe.skipIf(!!unsupported)("the first load of a very large program", () => {
  const { folder, build } = sharedBuilds("first-load-of-a-very-large-program", {
    "main.js": `import { join } from "node:path";\nconst found = new Map([["a", 1]]);\nconsole.log(found.get("a"), [3, 1, 2].sort().join(), join("a", "b"));\n`,
  });
  const looksVeryLarge = "--aot-limit=MaxSourceBytesExpectedToBeAnalyzed:1";
  const saysNothing = "--aot-disable=flow-results";

  test.each([
    ["the analysis says nothing, nothing is expected", [saysNothing], 2],
    ["the analysis says nothing, as expected", [saysNothing, looksVeryLarge], 1],
    ["the analysis comes to an end, which was not expected", [looksVeryLarge], 2],
    ["the analysis comes to an end, nothing is expected", [], 1],
  ])("%s: the engine runs %j, %d times", async (name, flags, engineRuns) => {
    const report = join(folder, `report-${flags.length}-${engineRuns}.json`);
    const built = await build("main.js", "--aot", ...flags, ...withReport(report, "summary"));
    expect(readBuildReport(report).statistics.EngineRuns).toBe(engineRuns);
    const printed = async (cmd: string[]) => (await run(cmd, folder, bunEnv)).stdout;
    expect(await printed([built.executable])).toBe(await printed([bunExe(), "main.js"]));
  });
});
