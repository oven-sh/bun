// With BUN_JSC_logAOTPhaseTimes=1 a build prints how many parallel loops it ran, by their number of indices and by how
// long they took, with the time inside them and the helpers they asked for. On one thread no loop is parallel.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { buildEnvironment, withThreads } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

const line =
  /^AOT parallel loops: from (\d+) indices \| from (\d+) us \| (\d+) loops \| [\d.e+-]+ ms \| ([\d.e+-]+) helpers asked for a loop$/;

test("the loops of a build are counted by size and by time", async () => {
  using dir = tempDir("aot-parallel-loops-are-counted", {
    "program.js": `function double(value) { return value * 2; }\nconsole.log(double(21));\n`,
  });
  const directory = String(dir);
  const linesAt = async (threads: number) => {
    const executable = join(directory, `program${threads}${isWindows ? ".exe" : ""}`);
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", withThreads(threads), "program.js", "--outfile", executable],
      directory,
      { ...bunEnv, [buildEnvironment.logsPhaseTimes]: "1" },
    );
    expect(built.exitCode).toBe(0);
    expect((await run([executable], directory, bunEnv)).stdout).toBe("42\n");
    return (built.stderr + built.stdout).split("\n").filter(text => text.startsWith("AOT parallel loops: "));
  };

  const lines = await linesAt(4);
  expect(lines.length).toBeGreaterThan(0);
  for (const text of lines) {
    const columns = line.exec(text);
    expect(columns).not.toBeNull();
    expect(Number(columns![1])).toBeGreaterThanOrEqual(2);
    expect(Number(columns![3])).toBeGreaterThan(0);
    expect(Number(columns![4])).toBeLessThanOrEqual(3);
  }
  expect(await linesAt(1)).toEqual([]);
});
