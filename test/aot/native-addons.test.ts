// An N-API addon is native code: it may hold, call and change what it is handed and what that reaches, at once and later, and it may read, call and change globals by name.
// ./native-addons/attack.c does all of that to compiled programs. It is built with the system's C compiler against the headers in src/runtime/napi, without node-gyp.
// Each program in that folder prints one line per attack: what the addon said, then what code that was compiled to loads from slots and to direct calls reads back.
// It runs under plain Bun and as an --aot executable, and the lines must be the same, but for three kinds:
//   LOCKED  the addon changes a built-in object. It gets what the program itself gets for the same store (LOCKED_BY=program).
//   TEXT    the addon has text evaluated. As plain Bun, or the call throws an EvalError and what the program reads afterwards is what it read before.
//   HIDDEN  the addon walks from the global object through process.mainModule, which the program never names. As plain Bun, or the walk throws a TypeError and nothing has changed.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join, resolve } from "path";
import { built, slot, spawned, unsupported } from "./run-programs";

const systemCC = process.env.CC || Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
const programs = join(import.meta.dir, "native-addons");

if (!systemCC)
  console.error("SKIPPED: test/aot/native-addons.test.ts: there is no C compiler: not in $CC, no cc, gcc or clang");

describe.skipIf(!systemCC || !!unsupported)("compile/aot/native-addons", () => {
  const folder = String(tempDir("aot-native-addons", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  const addon = join(folder, "attack.node");

  beforeAll(async () => {
    const functionsOfTheHost = join(folder, "functions-of-the-host.h");
    if (isWindows) {
      const called = new Set(readFileSync(join(programs, "attack.c"), "utf8").match(/\bnapi_\w+(?=\()/g));
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
        join(programs, "attack.c"),
        "-o",
        addon,
        ...(isWindows ? [] : ["-lpthread"]),
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
    "instances.js",
    "typed-instances.ts",
    "prototypes-and-class-objects.js",
    "literals-and-arrays.js",
    "closures-and-later-calls.js",
    "globals.js",
    "this-memory-and-what-the-addon-makes.js",
    "exports-of-a-commonjs-program.cjs",
    "exports-nobody-names.cjs",
    "text-run-by-the-addon.js",
  ])(
    "%s",
    name =>
      slot(async () => {
        const env = { ...bunEnv, ADDON: addon };
        const executable = join(folder, name.replace(/\.\w+$/, isWindows ? ".exe" : ""));
        built(
          await spawned(
            [bunExe(), "build", "--compile", "--aot", join(programs, name), "--outfile", executable],
            programs,
            bunEnv,
          ),
        );
        const compiled = await spawned([executable], programs, env);
        const plain = await spawned([bunExe(), "run", join(programs, name)], programs, env);
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

        const lines = (stdout: string) => stdout.split("\n");
        const isLocked = (line: string) => /^ *\d+ LOCKED /.test(line);
        const isText = (line: string) => /^ *\d+ TEXT /.test(line);
        const isHidden = (line: string) => /^ *\d+ HIDDEN /.test(line);
        const isOrdinary = (line: string) => !isLocked(line) && !isText(line) && !isHidden(line);
        expect(lines(compiled.stdout).filter(isOrdinary)).toEqual(lines(plain.stdout).filter(isOrdinary));

        if (lines(compiled.stdout).some(isLocked)) {
          const byProgram = await spawned([executable], programs, { ...env, LOCKED_BY: "program" });
          expect(lines(compiled.stdout).filter(isLocked)).toEqual(lines(byProgram.stdout).filter(isLocked));
        }

        const asPlain = new Set(lines(plain.stdout));
        const isRefused = (line: string) => /: "threw EvalError" \| after: (.*) \| before: \1$/.test(line);
        const text = lines(compiled.stdout).filter(isText);
        expect(text.length).toBe(lines(plain.stdout).filter(isText).length);
        // What earlier text did shows in the later lines, so either all of it runs or none.
        if (text.some(isRefused)) expect(text.filter(line => !isRefused(line))).toEqual([]);
        else expect(text.filter(line => !asPlain.has(line))).toEqual([]);

        const isNotFound = (line: string) => /: "threw TypeError" \| after: (.*) \| before: \1$/.test(line);
        const hidden = lines(compiled.stdout).filter(isHidden);
        expect(hidden.length).toBe(lines(plain.stdout).filter(isHidden).length);
        if (hidden.some(isNotFound)) expect(hidden.filter(line => !isNotFound(line))).toEqual([]);
        else expect(hidden.filter(line => !asPlain.has(line))).toEqual([]);
      }),
    600_000,
  );
});
