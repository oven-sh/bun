// A shipped executable tells nobody the folders of the machine that built it: its bytes do not hold them, it does not look into them, and no message names them. A message names a file as the
// executable knows it (/$bunfs/root/..), as the program wrote it, or where it really lies on the machine of the run.
import { afterAll, expect } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { compileCommand } from "./harness/flags";
import { built, spawned, withoutDebugInformation } from "./run-programs";
import { beforeAll, describe, test } from "./supported";

const secret = "the-folder-of-the-builder";

describe("compile/aot/an executable does not tell where it was built", () => {
  const root = String(tempDir("aot-where-it-was-built", {}));
  const source = join(root, secret);
  const elsewhere = join(root, "elsewhere");
  const executable = join(elsewhere, isWindows ? "program.exe" : "program");
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  beforeAll(async () => {
    mkdirSync(join(source, "lib"), { recursive: true });
    mkdirSync(join(elsewhere, "lib"), { recursive: true });
    writeFileSync(join(source, "lib", "inside.mjs"), `export const value = "inside";\n`);
    // The build cannot see the name under which this file is asked for, so it is not in the executable.
    writeFileSync(join(source, "lib", "outside.mjs"), `export const value = "of the folder of the build";\n`);
    writeFileSync(
      join(source, "main.mjs"),
      `import { value } from "./lib/inside.mjs";
const load = file => import(file);
try {
  console.log((await load(JSON.parse('["./lib/outside.mjs"]')[0])).value);
} catch (error) {
  console.log(error.code, error.message);
}
try {
  null.member;
} catch (error) {
  console.log(error.stack);
}
console.log(value, import.meta.url, import.meta.dir, process.argv[1], Bun.main);
`,
    );
    built(
      await spawned(
        [bunExe(), ...compileCommand, ...withoutDebugInformation(), "./main.mjs", "--outfile", executable],
        source,
        bunEnv,
      ),
    );
  }, 300_000);

  test("its bytes do not hold the folder", () => {
    expect(readFileSync(executable).includes(secret)).toBe(false);
  });

  test("it prints nothing of the folder, and does not find a file that lies there alone", async () => {
    const run = await spawned([executable], elsewhere, bunEnv);
    expect({ names: (run.stdout + run.stderr).includes(secret), exitCode: run.exitCode }).toEqual({
      names: false,
      exitCode: 0,
    });
    // The root of what is embedded is B:/~BUN/root on Windows.
    expect(run.stdout.split("\n")[0].replace(/B:[\\/]~BUN[\\/]root[\\/]/, "/$bunfs/root/")).toBe(
      "ERR_MODULE_NOT_FOUND Cannot find module './lib/outside.mjs' imported from /$bunfs/root/main.mjs",
    );
  });
});
