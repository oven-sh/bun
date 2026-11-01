import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./harness/declare";

// The program never names node:async_hooks. Code that the build has not seen enables an `init` hook, and from then on process.nextTick, which is
// the program's own, has to show each tick to the hook. Whichever copy of node:async_hooks enabled it: the one compiled with the program, or one
// made of the library's text, which an executable that runs code from outside does with the modules that it does not hold.
const files = {
  "from-disk.cjs": `
    const { createHook } = require("node:async_hooks");
    const seen = [];
    const hook = createHook({ init(asyncId, type, triggerAsyncId, resource) { seen.push(type + ":" + typeof resource.callback); } }).enable();
    module.exports = { seen, disable: () => hook.disable() };`,
  "body.mjs": `
    export async function run(hook) {
      try {
        process.nextTick(() => console.log("no argument"));
        process.nextTick((a, b) => console.log("two arguments", a, b), 1, 2);
        process.nextTick((a, b, c, d) => console.log("four arguments", a, b, c, d), 1, 2, 3, 4);
      } catch (error) {
        console.log("nextTick threw", error.constructor.name, error.message);
      }
      await new Promise(resolve => setImmediate(resolve));
      console.log("seen by init:", hook.seen.join());
      hook.disable();
      process.nextTick(() => console.log("behind disable()"));
      await new Promise(resolve => setImmediate(resolve));
      console.log("seen by init:", hook.seen.length);
    }`,
  "by-a-name-made-at-run-time.mjs": `
    import { run } from "./body.mjs";
    process.nextTick(() => console.log("before the hook"));
    await new Promise(resolve => setImmediate(resolve));
    await run((await import(process.argv[2])).default);`,
  "by-a-statement.mjs": `
    import hook from "./from-disk.cjs";
    import { run } from "./body.mjs";
    await run(hook);`,
};
const printed = [
  "no argument",
  "two arguments 1 2",
  "four arguments 1 2 3 4",
  "seen by init: TickObject:function,TickObject:function,TickObject:function",
  "behind disable()",
  "seen by init: 3",
];

async function run(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { lines: stdout.split("\n").filter(Boolean), stderr, exitCode };
}

for (const [entry, flags, expected] of [
  ["by-a-name-made-at-run-time.mjs", ["--aot-allow-code-from-disk"], ["before the hook", ...printed]],
  ["by-a-statement.mjs", ["--external", "./from-disk.cjs"], printed],
] as const)
  test.concurrent(
    `${flags[0]}: ${entry}`,
    async () => {
      using dir = tempDir("hooked-tick", files);
      const cwd = String(dir);
      const fromDisk = join(cwd, "from-disk.cjs");
      expect(await run([bunExe(), "run", entry, fromDisk], cwd)).toMatchObject({ lines: expected, exitCode: 0 });
      const executable = join(cwd, "program");
      const build = [bunExe(), "build", "--compile", "--aot", ...flags, entry, "--outfile", executable];
      expect(await run(build, cwd)).toMatchObject({ exitCode: 0 });
      expect(await run([executable, fromDisk], cwd)).toMatchObject({ lines: expected, exitCode: 0 });
    },
    240_000,
  );
