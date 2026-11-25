import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

// The second import() comes to the end of the first one's chain ahead of it. The first still settles in front of the second, whose graph holds all of its own.
function project(waits: number) {
  const files: Record<string, string> = {
    "main.mjs": [
      `let jobs = 0;`,
      `const job = () => { if (++jobs < 1500) queueMicrotask(job); };`,
      `queueMicrotask(job);`,
      `import("./part0.mjs").then(first => console.log("first", first.value));`,
      ...Array.from({ length: waits }, () => `await 0;`),
      `import("./second.mjs").then(second => console.log("second", second.value));`,
    ].join("\n"),
    "second.mjs": `import { value as whole } from "./part0.mjs";\nimport { value as end } from "./part7.mjs";\nexport const value = whole + end;\n`,
    "part8.mjs": `export const value = 1;\n`,
  };
  for (let index = 0; index < 8; index++)
    files[`part${index}.mjs`] = `import { value as next } from "./part${index + 1}.mjs";\nexport const value = next + 1;\n`;
  return files;
}

test.concurrent.each([0, 1])("a load that another comes ahead of keeps no steps of the levels it never goes through (%p waits)", async waits => {
  using dir = tempDir("aot-loads-come-ahead", project(waits));
  const cwd = String(dir);
  const executable = join(cwd, isWindows ? "main.exe" : "main");
  await using built = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", executable],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [buildErrors, buildExitCode] = await Promise.all([built.stderr.text(), built.exited]);
  expect({ buildExitCode, buildErrors }).toEqual({ buildExitCode: 0, buildErrors: expect.any(String) });
  await using ran = Bun.spawn({ cmd: [executable], cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, exitCode] = await Promise.all([ran.stdout.text(), ran.exited]);
  expect({ stdout, exitCode }).toEqual({ stdout: "first 9\nsecond 11\n", exitCode: 0 });
});
