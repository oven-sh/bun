import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { reads } from "./harness/reads";
import { test } from "./supported";

const few = isDebug || isASAN ? 500 : 2_000;
const many = 4 * few;

async function processorSecondsOfBuild(barrelCount: number) {
  const barrels = Array.from({ length: barrelCount }, (_, index) => [
    `b${index + 1}.mjs`,
    `export { load } from "./b${index}.mjs";\n`,
  ]);
  using dir = tempDir("aot-many-barrels", {
    "main.mjs": `import { load } from "./b${barrelCount}.mjs";\nconsole.log(load("./value.cjs"));\n`,
    "b0.mjs": `import { createRequire } from "node:module";\nexport const load = createRequire(import.meta.url);\n`,
    "value.cjs": "module.exports = 1;\n",
    ...Object.fromEntries(barrels),
  });
  const executable = join(String(dir), isWindows ? "main.exe" : "main");
  await using built = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", executable],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([built.stdout.text(), built.stderr.text(), built.exited]);
  expect({ output: exitCode ? stdout + stderr : "", exitCode }).toEqual({ output: "", exitCode: 0 });
  return Number(built.resourceUsage()!.cpuTime.user) / 1e6;
}

// Each round of the build teaches one more barrel what it hands on. Four times the barrels take less than twice as long where a round looks
// at what the round before it changed (every build has a floor), and more than three times as long where each round looks at every file.
test("build time is linear in the number of barrels that hand a made require on", async () => {
  const withFew = await processorSecondsOfBuild(few);
  const withMany = await processorSecondsOfBuild(many);
  reads("four times the barrels", withMany / withFew, 2.5, "times the processor seconds");
  expect(withMany / withFew).toBeLessThan(2.5);
}, 240_000);
