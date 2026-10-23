// Each program is compiled with --aot, runs with the interpreter forbidden, and must say what plain Bun says; a CommonJS program, what it
// says as an executable without --aot, where the bundler has linked its require() calls. Where this Bun can leave parts of the runtime
// out, the executable that is trimmed by what the program names must say the same again.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { canTrim } from "../bundler/compile-trim-features";
import { slot } from "./run-programs";
import { test } from "./supported";
import { run as runCommand } from "./harness/run";

export type Program = { source: string; name?: string; files?: Record<string, string>; stdin?: string; ipc?: "json" | "advanced"; greeting?: unknown; exitCode?: number; runsTextAsCode?: true; aheadOfTime?: string };

const normalize = (text: string) => text.replace(/\(node:\d+\)/g, "(node:PID)").replace(/\(Use `[^` ]+ --trace-warnings/g, "(Use `EXE --trace-warnings");

async function run(cmd: string[], cwd: string, program: Program, env: Record<string, string | undefined>) {
  const received: unknown[] = [];
  await using proc = Bun.spawn({
    cmd,
    cwd,
    env: { ...env, PLAIN_BUN: bunExe() },
    stdin: program.stdin === undefined ? "ignore" : new Blob([program.stdin]),
    stdout: "pipe",
    stderr: "pipe",
    ...(program.ipc
      ? {
          serialization: program.ipc,
          ipc(message, child) {
            received.push(message);
            child.send(message);
          },
        }
      : {}),
  });
  if (program.greeting !== undefined) proc.send(program.greeting);
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr: normalize(stderr), exitCode, received: received.length };
}

export function describePrograms(what: string, programs: Record<string, Program>) {
  describe.concurrent(what, () => {
    for (const [title, program] of Object.entries(programs)) {
      test.skipIf(isWindows && title.includes("$"))(title, async () => {
        const name = program.name ?? "main.mjs";
        using dir = tempDir("aot-built-in-functions-by-use", { [name]: program.source, ...program.files });
        const cwd = String(dir);
        await slot(async () => {
          const build = async (flags: string[], outfile: string) => {
            const { stderr: said, exitCode: built } = await runCommand([bunExe(), "build", "--compile", ...flags, name, "--outfile", outfile], cwd);
            expect({ title, flags, said, built }).toEqual({ title, flags, said: expect.any(String), built: 0 });
            return [outfile];
          };
          const expected = await run(name.endsWith(".cjs") ? await build([], join(cwd, "reference.exe")) : [bunExe(), name], cwd, program, bunEnv);
          expect({ title, exitCode: expected.exitCode, stderr: expected.stderr }).toEqual({ title, exitCode: program.exitCode ?? 0, stderr: expect.not.stringContaining("error:") });
          const compiled = program.aheadOfTime === undefined ? expected : { ...expected, stdout: program.aheadOfTime };
          expect(await run(await build(["--aot"], join(cwd, "program.exe")), cwd, program, program.runsTextAsCode ? bunEnv : { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" })).toEqual(compiled);
          if (canTrim) expect(await run(await build(["--aot", "--trim"], join(cwd, "trimmed.exe")), cwd, program, bunEnv)).toEqual(compiled);
        });
      }, 120_000);
    }
  });
}
