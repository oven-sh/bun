// The accesses of a swap need one test of the array's storage: the later ones stand behind the first one's yes. A validating build makes the later tests all the same and compares.
// The test compares the whole byte that names the kind of storage, and the lock of the cell lies in that byte. A marking thread holds the lock while it visits an array
// whose elements do not start where its storage starts: one that got an element in front. The storage stays what it was, so the build runs to its end.
import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const program = `
type Item = { name: string; text: string };

function swapMany(seconds: number): number {
  const list: Item[] = [];
  for (let i = 0; i < 20000; i++) list.push({ name: "n", text: "t" });
  list.splice(0, 0, { name: "first", text: "t" });
  const end = Date.now() + seconds * 1000;
  let sum = 0;
  let round = 0;
  while (Date.now() < end) {
    for (let turn = 0; turn < 2000; turn++, round++) {
      const at = 1 + (round % (list.length - 1));
      const other = round % 7;
      [list[at], list[other]] = [list[other], list[at]];
      list[at] = { name: "x" + round, text: "yy" };
      sum += list[at].text.length;
    }
  }
  return sum === round * 2 ? list.length : -1;
}

console.log(swapMany(Number(process.argv[2])));
`;

test("a validating build swaps elements behind an element inserted in front while the collector marks", async () => {
  using dir = tempDir("aot-swaps-while-the-collector-marks", { "main.ts": program });
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const build = await run(
    [bunExe(), "build", "--compile", "--aot", "--aot-validate", "main.ts", "--outfile", executable],
    String(dir),
  );
  expect(build.exitCode).toBe(0);
  const runs = await Promise.all(Array.from({ length: 4 }, () => run([executable, "5"], String(dir))));
  for (const { stdout, stderr, exitCode } of runs) {
    expect(stderr).not.toContain("AOT validation");
    expect(stdout).toBe("20001\n");
    expect(exitCode).toBe(0);
  }
}, 120_000);
