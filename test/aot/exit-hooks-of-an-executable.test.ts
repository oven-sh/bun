// Two things happen when a process exits that are about code loaded or decoded at run time: Node's compile cache is written, and
// the order in which an executable's bytecode was read. An executable compiled ahead of time has neither.
import { expect } from "bun:test";
import { existsSync, readdirSync, realpathSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { built, spawned } from "./run-programs";
import { test } from "./supported";

test("an executable with an image writes no bytecode order and an empty compile cache", async () => {
  using dir = tempDir("exit-hooks-of-an-executable", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: { typeRoots: [join(import.meta.dir, "../../packages")], types: ["bun-types"] },
    }),
    "main.ts": `import { join } from "node:path";\nconsole.log(join("a", "b"));\n`,
  });
  const root = realpathSync(String(dir));
  const executable = join(root, "program");
  built(await spawned([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable], root, bunEnv));
  const run = await spawned([executable], root, {
    ...bunEnv,
    BUN_BYTECODE_ORDER_OUT: join(root, "program.order"),
    BUN_BYTECODE_DIGEST_OUT: join(root, "program.digest"),
    NODE_COMPILE_CACHE: join(root, "cache"),
  });
  expect({ stdout: run.stdout.replaceAll("\\", "/"), stderr: run.stderr, exitCode: run.exitCode }).toEqual({
    stdout: "a/b\n",
    stderr: "",
    exitCode: 0,
  });
  expect(existsSync(join(root, "program.order"))).toBe(false);
  expect(existsSync(join(root, "program.digest"))).toBe(false);
  const cached = existsSync(join(root, "cache"))
    ? readdirSync(join(root, "cache"), { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
    : [];
  expect(cached).toEqual([]);
});
