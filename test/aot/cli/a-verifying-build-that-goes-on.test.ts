// --aot-check=verify-each-pass stops a build at the first verification that fails. With keep-going beside it the build goes on, keeps the first failure of each function,
// and ends with a line that counts them by pass and by what was found. It fails all the same and writes no executable.
import { expect } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { spawned } from "../harness/commands";
import { test } from "../supported";

const env = { ...bunEnv, NO_COLOR: "1" };
const program = `function tell(x) { if (x > 100) return tell(x - 1); console.log("told", x); return x; }
function first(k) { const o = { n: k, m: k + 1 }; tell(k); return o.n + o.m; }
function second(k) { const o = { a: k * 2 }; tell(k + 1); tell(k + 2); return o.a; }
const n = Number(process.argv[9] ?? 3);
console.log(first(n), second(n));
`;

async function build(...flags: string[]) {
  const dir = tempDir("aot-keep-going", { "program.js": program });
  const executable = join(String(dir), isWindows ? "app.exe" : "app");
  const { stderr, exitCode } = await spawned(
    [bunExe(), "build", "--compile", "--aot", ...flags, join(String(dir), "program.js"), "--outfile", executable],
    String(dir),
    env,
  );
  const lines = stderr.split("\n").filter(line => line.startsWith("error"));
  return { dir, exitCode, lines, wroteExecutable: existsSync(executable), executable };
}

// The sabotage takes a call out of a function behind each pass that runs on it.
const broken = "--aot-sabotage=PassesDropCalls";

test("the first failure of each function has one line, behind a line that counts them, and the build fails", async () => {
  const { dir, exitCode, lines, wroteExecutable } = await build("--aot-check=verify-each-pass,keep-going", broken);
  using _ = dir;
  const count = lines.filter(line => line.includes("BuildWentOnBehindFailedVerifications"));
  // The line that counts names what was found, and that may be this word too.
  const failures = lines.filter(line => line.includes("VerificationFailedAfterPass: verification failed after "));
  const functions = failures.map(line => /; function ([^;]+);/.exec(line)?.[1]);
  expect({
    exitCode,
    wroteExecutable,
    counts: count.length,
    others: lines.length - count.length - failures.length,
  }).toEqual({
    exitCode: 1,
    wroteExecutable: false,
    counts: 1,
    others: 0,
  });
  expect(failures.length).toBeGreaterThan(1);
  expect(new Set(functions).size).toBe(failures.length);
  expect(count[0]).toContain(`failed in ${failures.length} functions`);
}, 300_000);

test("a build in which every verification passes is not changed by it", async () => {
  const { dir, exitCode, lines, executable } = await build("--aot-check=verify-each-pass,keep-going");
  using _ = dir;
  expect({ exitCode, lines }).toEqual({ exitCode: 0, lines: [] });
  const ran = await spawned([executable], String(dir), env);
  expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({
    stdout: "told 3\ntold 4\ntold 5\n7 6\n",
    exitCode: 0,
  });
}, 300_000);
