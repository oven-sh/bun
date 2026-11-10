import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { reads } from "./harness/reads";
import { test } from "./supported";

const few = isDebug || isASAN ? 1_000 : 2_000;
const many = 4 * few;

const shapes = {
  "a name known in part": {
    head: `const pick = name => (process.argv.length > 9 ? process.argv[9] : name);\n`,
    load: `count += require("./plugins/" + pick("first") + ".cjs").one;\n`,
  },
  // Each load reads a name that the line above it stores, so the name has as many stores as the file has loads.
  "a name that is stored for each load": {
    head: `let name;\n`,
    load: `name = process.argv[9] || "./plugins/first.cjs"; count += require(name).one;\n`,
  },
};

async function processorSecondsOfBuild(loadCount: number, shape: keyof typeof shapes) {
  const { head, load } = shapes[shape];
  using dir = tempDir("aot-many-computed-loads", {
    "main.cjs": `${head}let count = 0;\n${load.repeat(loadCount)}console.log(count);\n`,
    "plugins/first.cjs": "exports.one = 1;\n",
  });
  const executable = join(String(dir), isWindows ? "main.exe" : "main");
  await using built = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "./main.cjs", "--outfile", executable],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([built.stdout.text(), built.stderr.text(), built.exited]);
  expect({ output: exitCode ? stdout + stderr : "", exitCode }).toEqual({ output: "", exitCode: 0 });
  return Number(built.resourceUsage()!.cpuTime.user) / 1e6;
}

// Each load may find the same few files. Four times the loads take about twice as long where the time is linear (every build has a floor),
// and more than four times as long where each load walks what all the loads of its file may find.
test.each(Object.keys(shapes) as (keyof typeof shapes)[])(
  "build time is linear in the number of computed loads in one file: %s",
  async shape => {
    const withFew = await processorSecondsOfBuild(few, shape);
    const withMany = await processorSecondsOfBuild(many, shape);
    reads("four times the loads", withMany / withFew, 3.5, "times the processor seconds");
    expect(withMany / withFew).toBeLessThan(3.5);
  },
  240_000,
);
