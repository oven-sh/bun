// An N-API addon sees typed objects as it sees ordinary ones, and typed code takes what the addon creates.
// ./napi-addon/addon.c is built with the system's C compiler against the headers in src/runtime/napi, without node-gyp. Each program in
// that folder loads it with process.dlopen and prints one line per N-API call. It runs under plain Bun and as an --aot executable, and the lines must be the same.
// A line that begins with TYPE makes one call that stores what the declared type does not allow, and prints what the call said, what
// the object looks like afterwards, and what an object that nobody touched looks like. There --aot may differ from plain Bun in
// two ways only: the call fails with an error and leaves the object untouched, or typed code that reads the object afterwards throws.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join, resolve } from "path";
import { built, slot, spawned, unsupported } from "./run-programs";

const systemCC = process.env.CC || Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
const programs = join(import.meta.dir, "napi-addon");

if (!systemCC)
  console.error("SKIPPED: test/aot/napi-addon.test.ts: there is no C compiler: not in $CC, no cc, gcc or clang");

describe.skipIf(!systemCC || !!unsupported)("compile/aot/napi-addon", () => {
  const folder = String(tempDir("aot-napi-addon", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  const addon = join(folder, "addon.node");

  beforeAll(async () => {
    const functionsOfTheHost = join(folder, "functions-of-the-host.h");
    if (isWindows) {
      const called = new Set(readFileSync(join(programs, "addon.c"), "utf8").match(/\bnapi_\w+(?=\()/g));
      writeFileSync(
        functionsOfTheHost,
        `#include <node_api.h>\nvoid* GetModuleHandleW(const void*);\nvoid* GetProcAddress(void*, const char*);\n#define HOST(function) ((__typeof__(&function))GetProcAddress(GetModuleHandleW(NULL), #function))\n` +
          [...called].map(name => `#define ${name} HOST(${name})\n`).join(""),
      );
    }
    const compile = await spawned(
      [
        systemCC!,
        "-shared",
        ...(isWindows ? ["-include", functionsOfTheHost] : ["-fPIC"]),
        ...(process.platform === "darwin" ? ["-undefined", "dynamic_lookup"] : []),
        "-I" + resolve(import.meta.dir, "../../src/runtime/napi"),
        join(programs, "addon.c"),
        "-o",
        addon,
      ],
      programs,
      bunEnv,
    );
    expect({ stderr: compile.stderr, exitCode: compile.exitCode }).toEqual({
      stderr: expect.not.stringContaining("error"),
      exitCode: 0,
    });
  });

  test.concurrent.each([
    "objects",
    "declared-interface",
    "created-by-the-addon",
    "referenced-by-the-addon",
    "classes-and-callbacks",
  ])(
    "%s",
    name =>
      slot(async () => {
        const env = { ...bunEnv, ADDON: addon };
        const executable = join(folder, name);
        built(
          await spawned(
            [bunExe(), "build", "--compile", "--aot", join(programs, name + ".ts"), "--outfile", executable],
            programs,
            bunEnv,
          ),
        );
        const compiled = await spawned([executable], programs, env);
        const plain = await spawned([bunExe(), "run", join(programs, name + ".ts")], programs, env);
        expect({ signal: plain.signal, exitCode: plain.exitCode, stderr: plain.stderr }).toEqual({
          signal: null,
          exitCode: 0,
          stderr: "",
        });
        expect({ signal: compiled.signal, exitCode: compiled.exitCode, stderr: compiled.stderr }).toEqual({
          signal: null,
          exitCode: 0,
          stderr: "",
        });

        const isAboutTheType = (line: string) => /^ *\d+ TYPE /.test(line);
        const lines = (stdout: string) => stdout.split("\n");
        expect(lines(compiled.stdout).filter(line => !isAboutTheType(line))).toEqual(
          lines(plain.stdout).filter(line => !isAboutTheType(line)),
        );
        const asPlain = new Set(lines(plain.stdout));
        const isRefused = (line: string) =>
          /^[^:]*: "threw .*" \| after: (.*) \| untouched: \1$/.test(line) ||
          / \| after: "threw .*" \| untouched: /.test(line);
        expect(
          lines(compiled.stdout).filter(line => isAboutTheType(line) && !asPlain.has(line) && !isRefused(line)),
        ).toEqual([]);
        expect(lines(compiled.stdout).filter(isAboutTheType).length).toBe(
          lines(plain.stdout).filter(isAboutTheType).length,
        );
      }),
    600_000,
  );

  test(
    "an addon is not loaded by a require() of a computed path",
    () =>
      slot(async () => {
        const env = { ...bunEnv, ADDON: addon };
        const source = join(programs, "required-by-a-computed-path.ts");
        const executable = join(folder, "required-by-a-computed-path");
        built(
          await spawned([bunExe(), "build", "--compile", "--aot", source, "--outfile", executable], programs, bunEnv),
        );
        const said = ({ stdout, stderr, exitCode }: { stdout: string; stderr: string; exitCode: number }) => ({
          stdout,
          stderr,
          exitCode,
        });
        expect(said(await spawned([bunExe(), "run", source], programs, env))).toEqual({
          stdout: "loaded function\n",
          stderr: "",
          exitCode: 0,
        });
        expect(said(await spawned([executable], programs, env))).toEqual({
          stdout:
            "MODULE_NOT_FOUND Cannot load '<addon>': it isn't in this executable, which only runs code that was compiled into it. Pass the file to bun compile as another entry point, or build with --aot-allow-code-from-disk.\n",
          stderr: "",
          exitCode: 0,
        });
      }),
    600_000,
  );
});
