// A row written in place holds the name of a file and a function that another file exports. The function is called off the row, so the row is its `this`, and nobody knows at the
// build what the function does with it: it may store another name into the row. The name is not followed: the build says so (TS100064) and the name is made at the run.
// The file that the row names as it is written still comes along, so this program, whose function does no harm, finds it. Its twin whose function does store another name is warned alike.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

test("the build warns, and the executable holds the file that is written", async () => {
  using dir = tempDir("a-function-of-another-file-called-off-a-row", {
    "main.cjs": `const { use } = require("./use.cjs");
for (const row of [["./one.cjs", use]]) console.log("SAID", row[1](require(row[0])));
`,
    "use.cjs": `exports.use = found => found.name;\n`,
    "one.cjs": `exports.name = "one";\n`,
  });
  const cwd = String(dir);
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", "out/program"], cwd);
  expect({ warns: built.stderr.includes("TS100064"), exitCode: built.exitCode }).toEqual({ warns: true, exitCode: 0 });
  rmSync(join(cwd, "one.cjs"));
  expect(await run([join(cwd, "out", "program")], join(cwd, "out"))).toEqual({
    stdout: "SAID one\n",
    stderr: "",
    exitCode: 0,
  });
});
