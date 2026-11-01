// A list of 300,000,001 elements with two values in it: toSorted() with a comparator threw `RangeError: Out of memory` before it had read an element.
// Plain Bun is not run here: it makes the 300,000,001 elements of the result first, 7 GB in 50 s, and then says what is stored below. A comparator that throws ends
// the compiled program before there is a result, so the test takes the memory of the two values.
import { expect } from "bun:test";
import { realpathSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { built, spawned } from "./harness/commands";
import { test } from "./supported";

test("the comparator is asked about the values of a list that is longer than storage in one piece", async () => {
  using dir = tempDir("a-sorted-copy-of-a-list-longer-than-storage-in-one-piece", {
    "main.js": `
      const list = [];
      list[300_000_000] = 1;
      list[0] = 2;
      let seen;
      const before = process.resourceUsage().maxRSS;
      try {
        list.toSorted(() => {
          throw new Error("the comparator was asked");
        });
        seen = "no error";
      } catch (error) {
        seen = error.name + ": " + error.message;
      }
      console.log(seen, "| grew by less than 128 MB:", process.resourceUsage().maxRSS - before < 128 * 1024);
    `,
  });
  const root = realpathSync(String(dir));
  const executable = join(root, "program");
  built(await spawned([bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", executable], root, bunEnv));
  const compiled = await spawned([executable], root, bunEnv);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
    stdout: "Error: the comparator was asked | grew by less than 128 MB: true\n",
    exitCode: 0,
  });
});
