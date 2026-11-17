// An executable built with --aot-allow-code-from-disk holds the modules of the library that its own code names. A file from disk may ask for any other, and that one runs from its text, beside built-ins that are read-only.
// A module that writes to a built-in at its top level is refused there unless the table says so (the mark IsDeletedWhenModuleOfLibraryLoads). Every module is asked for, each in a process of its own.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { builtinModules } from "node:module";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const names = [...new Set([...builtinModules, "bun:ffi", "bun:jsc", "bun:sqlite", "bun:test", "bun:wrap"])].sort();

test("every module of the library loads from its text where code from disk asks for it", async () => {
  using dir = tempDir("aot-every-module-from-its-text", {
    "main.cjs": `require(require("node:path").resolve(process.argv[2]));`,
    "from-disk.cjs": `
      try { require(process.argv[3]); console.log("loaded"); } catch (error) { console.log(error.constructor.name + ": " + String(error.message).split("\\n")[0]); }`,
  });
  const cwd = String(dir);
  const executable = join(cwd, "program");
  const build = [
    bunExe(),
    "build",
    "--compile",
    "--aot",
    "--aot-allow-code-from-disk",
    "main.cjs",
    "--outfile",
    executable,
  ];
  expect((await run(build, cwd, bunEnv)).exitCode).toBe(0);
  expect(names.length).toBeGreaterThan(70);
  const said = await Promise.all(
    names.map(
      async name => `${name}: ${(await run([executable, "./from-disk.cjs", name], cwd, bunEnv)).stdout.trim()}`,
    ),
  );
  expect(said.filter(line => !line.endsWith(": loaded"))).toEqual([]);
}, 240_000);
