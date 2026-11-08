// The shorter roads of node:http ask first whether the methods that they leave out are still the library's own. An accessor of the program's on the request itself can tell how it is asked:
// it is asked as often as plain Bun asks it, and what it throws goes where it goes in plain Bun. What lies on one request is noticed for all, so every case is a process of its own.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(170_000);

const program = join(
  import.meta.dir,
  "an-accessor-on-a-request-itself-is-asked-as-often-as-plain-bun-asks-it",
  "one-accessor-a-process.mjs",
);

test("each case prints what it prints under plain Bun", async () => {
  using directory = tempDir("one-accessor-a-process", {});
  const executable = join(String(directory), "one-accessor-a-process");
  const build = await run(
    [bunExe(), "build", "--compile", "--aot", program, "--outfile", executable],
    String(directory),
  );
  expect(build).toMatchObject({ exitCode: 0 });

  const cases = (await run([bunExe(), program], String(directory))).stdout.trim().split("\n");
  expect(cases.length).toBeGreaterThan(70);
  const seen = async (command: string[], name: string) => {
    const { stdout, exitCode } = await run(command, String(directory), { ...bunEnv, CASE: name });
    return { stdout, exitCode };
  };
  const differing: unknown[] = [];
  let next = 0;
  const worker = async () => {
    while (next < cases.length) {
      const name = cases[next++];
      const [plain, compiled] = await Promise.all([seen([bunExe(), program], name), seen([executable], name)]);
      if (
        plain.exitCode !== 0 ||
        !plain.stdout.startsWith(name + "\n") ||
        compiled.stdout !== plain.stdout ||
        compiled.exitCode !== 0
      )
        differing.push({ name, plain, compiled });
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  expect(differing).toEqual([]);
});
