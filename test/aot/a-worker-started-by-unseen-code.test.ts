import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "worker.cjs": `
    console.log("printed by the worker");
    let refused;
    try { process.chdir("/"); } catch (error) { refused = error.code; }
    postMessage([21, refused]);`,
  "unseen.cjs": `
    module.exports = file => new Promise(resolve => {
      const { Worker } = require("node:worker_threads");
      const worker = new Worker(file);
      worker.on("message", resolve);
      worker.on("error", error => resolve(error.message));
    });`,
  "by-a-name-made-at-run-time.mjs": `
    const start = (await import(process.argv[2])).default;
    console.log("worker", JSON.stringify(await start(process.argv[3])), typeof console.log);`,
  "by-a-statement.mjs": `
    import start from "./unseen.cjs";
    console.log("worker", JSON.stringify(await start(process.argv[3])), typeof console.log);`,
};

test.concurrent.each([
  ["by-a-name-made-at-run-time.mjs", ["--aot-allow-code-from-disk"]],
  ["by-a-statement.mjs", ["--external", "./unseen.cjs", "./worker.cjs"]],
])(
  "%s",
  async (entry, flags) => {
    using dir = tempDir("aot-worker-started-by-unseen-code", files);
    const cwd = String(dir);
    const more = [join(cwd, "unseen.cjs"), "./worker.cjs"];
    const printedBy = async (cmd: string[]) => {
      const { stdout, exitCode } = await run(cmd, cwd, bunEnv);
      return { lines: stdout.split("\n").filter(Boolean).sort(), exitCode };
    };
    const plain = await printedBy([bunExe(), "run", entry, ...more]);
    expect(plain).toEqual({
      lines: ["printed by the worker", 'worker [21,"ERR_WORKER_UNSUPPORTED_OPERATION"] function'],
      exitCode: 0,
    });
    const executable = join(cwd, "program");
    const build = [bunExe(), "build", "--compile", "--aot", entry, ...flags, "--outfile", executable];
    expect((await run(build, cwd, bunEnv)).exitCode).toBe(0);
    expect(await printedBy([executable, ...more])).toEqual(plain);
  },
  240_000,
);
