// process.dlopen hands its third argument to dlopen(), in compiled code as in plain Bun.
// ./process-dlopen-flags/core.c and plugin.c are built with the system's C compiler against the headers in src/runtime/napi, without
// node-gyp. Each program in that folder runs under plain Bun and as an --aot executable.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, bunExe, isASAN, isGlibc, isWindows, tempDir } from "harness";
import { join, resolve } from "path";
import { built, slot, spawned, unsupported } from "./harness/commands";

const systemCC = process.env.CC || Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
const programs = join(import.meta.dir, "process-dlopen-flags");

if (!systemCC && !isWindows)
  console.error(
    "SKIPPED: test/aot/process-dlopen-flags.test.ts: there is no C compiler: not in $CC, no cc, gcc or clang",
  );

// Windows has no mode for a library: process.dlopen converts the flags there and does not use them.
describe.skipIf(isWindows || !systemCC || !!unsupported)("compile/aot/process-dlopen-flags", () => {
  const folder = String(tempDir("aot-process-dlopen-flags", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  const core = join(folder, "core.node");
  const plugin = join(folder, "plugin.so");

  beforeAll(async () => {
    const headers = "-I" + resolve(import.meta.dir, "../../src/runtime/napi");
    for (const [source, library] of [
      ["core.c", core],
      ["plugin.c", plugin],
    ]) {
      const compile = await spawned(
        [
          systemCC!,
          "-shared",
          "-fPIC",
          ...(process.platform === "darwin" ? ["-undefined", "dynamic_lookup"] : []),
          headers,
          join(programs, source),
          "-o",
          library,
        ],
        programs,
        bunEnv,
      );
      expect({ stderr: compile.stderr, exitCode: compile.exitCode }).toEqual({
        stderr: expect.not.stringContaining("error"),
        exitCode: 0,
      });
    }
  });

  // What the program of that name prints as an --aot executable and under plain Bun.
  async function run(name: string) {
    const env = { ...bunEnv, CORE: core, PLUGIN: plugin };
    const source = join(programs, name + ".ts");
    const executable = join(folder, name);
    built(await spawned([bunExe(), "build", "--compile", "--aot", source, "--outfile", executable], programs, bunEnv));
    return {
      compiled: await spawned([executable], programs, env),
      plain: await spawned([bunExe(), "run", source], programs, env),
    };
  }

  test("the flags are converted before the module is read, and the library is opened with them", () =>
    slot(async () => {
      const expected = {
        stdout:
          "converted: flags, exports\n" +
          "the plugin answers 43\n" +
          "a symbol for the flags throws TypeError ERR_INVALID_ARG_TYPE\n" +
          "one argument throws TypeError ERR_MISSING_ARGS\n",
        stderr: "",
        exitCode: 0,
        signal: null,
      };
      const { compiled, plain } = await run("flags");
      expect(plain).toEqual(expected);
      expect(compiled).toEqual(expected);
    }));

  // An executable with compiled code defines libc's signal functions, so that the action that a library sets for SIGSEGV stays
  // behind the one that compiled code needs. A library opened with RTLD_DEEPBIND would find libc's functions first, so there
  // the flag is not passed on. glibc alone has it, and a sanitizer's run time defines sigaction() and signal() itself.
  test.skipIf(!isGlibc || isASAN)("RTLD_DEEPBIND is passed on under plain Bun, and not beside compiled code", () =>
    slot(async () => {
      const { compiled, plain } = await run("deep-binding");
      expect(plain).toEqual({
        stdout: "signal() of the addon is the program's own: false\nreads of null that threw a TypeError: 10\n",
        stderr: "",
        exitCode: 0,
        signal: null,
      });
      expect(compiled).toEqual({
        stdout: "signal() of the addon is the program's own: true\nreads of null that threw a TypeError: 10\n",
        stderr: "",
        exitCode: 0,
        signal: null,
      });
    }),
  );
});
