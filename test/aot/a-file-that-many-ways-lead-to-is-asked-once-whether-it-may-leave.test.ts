// A store on a built-in is reported as one that every run comes to or as one that a run may come to. To tell the two apart the build asks of every file that runs in front of the
// store whether its body may leave: throw, wait, end the process. It asked anew by every way that leads to a file. Where each file requires the next one twice that is twice as
// often with each file more: 1.4 G instructions at 12 files, 20 G at 22. At sixty the build does not end.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(60_000);

test("a chain of sixty files each of which requires the next one twice is built", async () => {
  const last = 60;
  const files: Record<string, string> = {
    "main.mjs": `require("./f0.cjs");
if (process.argv.length > 99) Array.prototype.push = function () { return 0; };
console.log("SAID", [1, 2].length);
`,
  };
  for (let i = 0; i <= last; i++) files[`f${i}.cjs`] = i < last ? `require("./f${i + 1}.cjs");\n`.repeat(2) : "";
  using dir = tempDir("many-ways-to-a-file", files);
  const cwd = String(dir);
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", "program"], cwd);
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(await run([join(cwd, "program")], cwd)).toEqual({ stdout: "SAID 2\n", stderr: "", exitCode: 0 });
});
