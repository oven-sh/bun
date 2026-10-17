import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

// Bun resolves a promise with what the main file exports, so a `then` among the exports is called, once.

const mains: Record<string, string> = {
  "an-object.cjs": `module.exports = { then(resolve) { console.log("then is called"); resolve(); } };\nconsole.log("ran");\n`,
  "a-name.cjs": `exports.then = function (resolve) { console.log("then is called"); resolve(); };\nconsole.log("ran");\n`,
  "an-export.mjs": `export function then(resolve) { console.log("then is called"); resolve(); }\nconsole.log("ran");\n`,
  "no-then.mjs": `export function than() { console.log("nobody calls it"); }\nqueueMicrotask(() => console.log("a microtask"));\nsetTimeout(() => console.log("a timer"));\nconsole.log("ran");\n`,
};

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  await using proc = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

async function isAsPlain(main: string, text: string) {
  using dir = tempDir("then-of-the-main-file", { [main]: text });
  const plain = await run([bunExe(), "run", main], String(dir), bunEnv);
  expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const build = await run([bunExe(), "build", "--compile", "--aot", main, "--outfile", "program"], String(dir), bunEnv);
  expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  const aot = await run([join(String(dir), "program")], String(dir), {
    ...bunEnv,
    BUN_JSC_crashIfInterpreterIsUsed: "1",
  });
  expect({ stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
}

for (const main of Object.keys(mains)) {
  test(
    `a \`then\` that the main file exports is called as often as under bun run: ${main}`,
    () => isAsPlain(main, mains[main]),
    120_000,
  );
}

test.todo("a `then` that a main file exports which awaits at its top level is called as often as under bun run", () =>
  isAsPlain(
    "main.mjs",
    `export function then(resolve) { console.log("then is called"); resolve(); }\nawait 0;\nconsole.log("ran");\n`,
  ),
);
