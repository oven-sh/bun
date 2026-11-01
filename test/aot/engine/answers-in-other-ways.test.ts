// The IR tests under `answers/` are programs that run in the shell and hold what they answer, and no count and no shape of code. An answer does not hang on how a
// program was compiled: each of them gives it again with what the compiler took for proven checked at run time, in a validating build, with every prediction
// failing now and then, as hot and as cold code, without expected types, without the results of the flow analysis and with every allocation on its slow path.
//   testaot run <aot/tests>/answers --option=<way> --show-output
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { engineTests, run, whyNoNativeTests } from "./testaot";

const ways = [
  "testing=CheckProofsAtRunTime",
  "validate",
  "testing=FailPredictions",
  "heat=EverythingIsHot",
  "heat=EverythingIsCold",
  "testing=IgnoreExpectedTypes",
  "testing=IgnoreBranchHints",
  "testing=ForceGCSlowPaths",
  "testing=OverwriteDeadValuesAtCollections",
  "disable=flow-results",
];
const folders = [join(engineTests ?? "", "answers"), join(import.meta.dir, "..", "engine-tests", "answers")].filter(
  existsSync,
);

test.skipIf(!!whyNoNativeTests).each(ways)(
  "the programs under answers/ answer the same with %s",
  async way => {
    const { lines } = await run("run", ...folders, `--option=${way}`);
    expect({ failed: lines.filter(line => line.startsWith("FAIL ")), lastLine: lines.at(-1) }).toEqual({
      failed: [],
      lastLine: expect.stringMatching(/^[1-9][0-9]* passed, 0 failed, 0 todo$/),
    });
  },
  240_000,
);
