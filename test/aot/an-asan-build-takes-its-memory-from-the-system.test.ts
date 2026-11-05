// AddressSanitizer sees only what malloc hands out. A Bun built with it takes the memory of strings, lists and hash tables from malloc, without a variable that says so.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";

test.skipIf(!isASAN)("AddressSanitizer sees the strings that a program makes", async () => {
  const program = `const made = []; for (let i = 0; i < 100000; i++) made.push(("x" + i).repeat(3) + i); console.log(made.length);`;
  const { Malloc: _, ...env } = bunEnv;
  await using child = Bun.spawn({
    cmd: [bunExe(), "-e", program],
    env: {
      ...env,
      ASAN_OPTIONS: (env.ASAN_OPTIONS ?? "allow_user_segv_handler=1") + ":detect_leaks=0:atexit=1:print_stats=1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  expect(stdout).toBe("100000\n");
  const calls = Number(/malloced .* by (\d+) calls/.exec(stderr)?.[1]);
  expect(calls).toBeGreaterThan(300_000);
  expect(exitCode).toBe(0);
});
