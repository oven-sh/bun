import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./run";

/** For ../require-cache-in-test-runs*.test.ts: the test files of a project pass and print compiled what they pass and print under plain `bun test`. */
export async function expectCompiledToRunAsPlain(files: Record<string, string>, ...always: string[]) {
  using dir = tempDir("require-cache-in-test-runs", files);
  const endsInAnyOrder = always.some(flag => flag.startsWith("--parallel"));
  const test = async (...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...always, ...flags], String(dir), bunEnv);
    if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
    const passed = [...stderr.matchAll(/^\(pass\) (.*?)(?: \[.*\])?$/gm)].map(match => match[1]);
    return { stdout, passed: endsInAnyOrder ? passed.sort() : passed, exitCode };
  };
  const plain = await test();
  expect(plain.exitCode).toBe(0);
  expect(plain.passed).not.toEqual([]);
  expect(await test("--aot")).toEqual(plain);
}
