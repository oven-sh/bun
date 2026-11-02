import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

// supported.ts sets the limit for the first file of a process alone.
raiseDefaultTimeout(120_000);

// terminate() raises an exception in the Worker wherever it stands, also inside an operation of the run time that has nothing to refuse: "it does not throw" does not hold for
// that one. An operation that asserts so ends the whole process. The arguments are constants, so these are the calls that a build may prepare.
const worker = `for (;;) {
  new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short" });
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
  new Date(0).toLocaleString("en-US", { timeZone: "UTC" });
  (1234.5).toLocaleString("en-US");
}
`;
const main = `const ended = worker => new Promise(resolve => worker.addEventListener("close", resolve));
for (let round = 0; round < 12; round++) {
  const workers = Array.from({ length: 8 }, () => new Worker(new URL("./worker.js", import.meta.url).href));
  const all = workers.map(ended);
  for (const worker of workers) setTimeout(() => worker.terminate(), Math.random() * 16);
  await Promise.all(all);
}
console.log("every Worker has ended");
`;

test("Workers that are ended while they make formatters take nobody with them", async () => {
  using directory = tempDir("aot-workers-ended-while-they-make-formatters", { "main.js": main, "worker.js": worker });
  const executable = join(String(directory), isWindows ? "program.exe" : "program");
  const build = [bunExe(), "build", "--compile", "--aot", "./main.js", "./worker.js", "--outfile", executable];
  expect(await run(build, String(directory), bunEnv)).toMatchObject({ exitCode: 0 });
  const well = { stdout: "every Worker has ended\n", exitCode: 0 };
  expect(await run([bunExe(), "run", "./main.js"], String(directory), bunEnv)).toMatchObject(well);
  for (let time = 0; time < 3; time++) expect(await run([executable], String(directory), bunEnv)).toMatchObject(well);
});
