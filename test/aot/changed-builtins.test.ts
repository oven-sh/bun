import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { runsWholeGrids } from "./harness/ways";
import { test } from "./supported";

// A member of a native module's object is changed out of sight, and is then used for the first time by a call that is bound to the built-in:
// the call is refused with a TypeError that names the member. A build that is right binds none of these calls, so none of them comes to the refusal, and
// ./run-parallel.ts holds each program of the folder against plain Bun. The sabotage brings back a false conclusion: that nobody changes the object of a module out of sight.
const folder = join(import.meta.dir, "parallel", "changed-builtins");
const bindsWrongly = ["--aot-sabotage=ObjectsOfModulesCountAsLocked"];
// Without the refusal every one of them crashed in the same way.
const witness = "getter.mjs";
const others = [
  "setter-alone.mjs",
  "deleted.mjs",
  "number.mjs",
  "buffer-getter.mjs",
  "used-as-value.mjs",
  "getter-throws.mjs",
  "link-changed.mjs",
];

async function run(command: string[], cwd: string) {
  await using child = Bun.spawn({
    cmd: command,
    cwd,
    env: { ...bunEnv, BUN_ENABLE_CRASH_REPORTING: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode, signal: child.signalCode };
}

async function built(program: string, dir: string) {
  const exe = join(dir, isWindows ? "program.exe" : "program");
  const build = await run([bunExe(), "build", "--compile", "--aot", ...bindsWrongly, program, "--outfile", exe], dir);
  expect({ stderr: build.stderr, exitCode: build.exitCode }).toMatchObject({ exitCode: 0 });
  return run([exe], dir);
}

for (const program of runsWholeGrids ? [witness, ...others] : [witness]) {
  test.concurrent(`${program} is refused in words where the build bound the call wrongly`, async () => {
    using dir = tempDir("changed-builtins", {});
    const ran = await built(join(folder, program), String(dir));
    expect({ stdout: ran.stdout, signal: ran.signal, exitCode: ran.exitCode }).toEqual({
      stdout: "done TypeError\n",
      signal: null,
      exitCode: 0,
    });
  });
}

test("a refusal names the member and the line", async () => {
  using dir = tempDir("changed-builtins", {
    "uncaught.mjs": `import types from "node:util/types";
new Function(JSON.parse(JSON.stringify('Object.defineProperty(process.getBuiltinModule("node:util/types"), "isDate", { get() { return () => "mine"; }, configurable: true });')))();
console.log(types.isDate(1));
`,
  });
  const ran = await built(join(String(dir), "uncaught.mjs"), String(dir));
  expect(ran.stderr).toContain(
    "TypeError: Cannot call node:util/types.isDate because it was replaced, redefined or deleted before its first use",
  );
  expect(ran.stderr).toContain("uncaught.mjs:3:");
  expect({ signal: ran.signal, exitCode: ran.exitCode }).toEqual({ signal: null, exitCode: 1 });
});
