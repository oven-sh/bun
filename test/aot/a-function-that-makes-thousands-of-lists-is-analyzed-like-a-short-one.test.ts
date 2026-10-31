// The escape analysis keeps, for each value, the set of objects that the value may be. As rows of a bit for each object of the function these sets took
// values times objects: 8000 list literals in one function cost the build 50 MB, 90 MB where the lists hold objects, and past 16384 the analysis gave up.
// A set holds an object or two however long the function is, so what the sets take grows with the function, and the analysis gets to its end.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { readBuildReport } from "./harness/build-report";
import { built, spawned } from "./harness/commands";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { withReport } from "./harness/flags";
import { test } from "./supported";

raiseDefaultTimeout(240_000);

const literals = 20_000;
const chainFrom = (first: string, last: string) =>
  `const v0 = ${first};\n` +
  Array.from({ length: literals }, (_, index) => `const v${index + 1} = [v${index}][0];\n`).join("") +
  `console.log(${last.replace("$", "v" + literals)});\n`;

test.each([
  ["a number", chainFrom("1", "$"), "1"],
  ["an object", chainFrom("{ name: process.argv.length }", "typeof $.name"), "number"],
])("lists that each hold %s read from the list before", async (_, program, printed) => {
  using folder = tempDir("aot-thousands-of-lists", { "main.js": program });
  const report = join(String(folder), "report.json");
  const executable = join(String(folder), isWindows ? "main.exe" : "main");
  built(
    await spawned(
      [bunExe(), "build", "--compile", "--aot", ...withReport(report, "summary"), "./main.js", "--outfile", executable],
      String(folder),
      bunEnv,
    ),
  );
  const { stdout, exitCode } = await spawned([executable], String(folder), bunEnv);
  const limitsHit = readBuildReport(report)
    .limits.filter(limit => limit.hits)
    .map(limit => limit.name);
  expect({ stdout: stdout.trim(), exitCode, limitsHit }).toEqual({ stdout: printed, exitCode: 0, limitsHit: [] });
});
