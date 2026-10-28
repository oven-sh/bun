// Programs that died of a signal in the `jsc` shell on one platform alone. heat/run-heat.ts deals one program in forty to a run, so the next
// run on that platform would most likely not take them. Every run takes these: as they stand, and compiled as if every function were hot,
// cold, or neither. Where the shell dies of a signal on Linux, shell/quick.py says where (shell/where-it-died.py). shell/tools.ts says what
// the scripts need.
import { expect, test } from "bun:test";
import { join } from "path";
import { run } from "./harness/run";
import { unsupported } from "./run-programs";
import { python, scriptEnvironment, scriptSkipReason } from "./shell/tools";

const programs = [
  // Linux on ARM64: signal 11 at each of the three heats, after the line "left early": an array is frozen in a loop, a store to it throws
  // and is caught there, and the run counts the calls of operations.
  "arrays/index-fill-grows-like-push",
  // Its kin, so that the same run says what that death needs. Stores to frozen arrays throw and are caught, and the run does not count.
  "arrays/frozen-array-error-messages",
  // Arrays are frozen and the run counts, and nothing throws.
  "arrays/elements-of-frozen-arrays-that-fit-are-not-coerced",
  // Linux on x64, a shell built with assertions: signal 6 as they stand and at each of the three heats. A module of the image loads another
  // under a name that the program computes, and the shell took the path of the first for a URL.
  "modules/two-loads-of-a-module-that-cannot-be-linked-give-one-error",
  "structural-types/a-module-imported-by-a-computed-name-is-untyped",
];

/** What shell/quick.py passes over for now is printed, so that every run on that platform says where the shell died. The other lines. */
function withoutTodo(text: string) {
  const lines = text.split("\n").filter(line => line !== "");
  const todo = lines.filter(line => line.includes(": skipped: TODO: "));
  if (todo.length) console.error(todo.join("\n"));
  return { lines: lines.filter(line => !todo.includes(line)), todo: todo.length };
}

if (scriptSkipReason && !unsupported)
  console.error(`SKIPPED: test/aot/programs-that-died-in-the-shell-on-one-platform.test.ts: ${scriptSkipReason}`);

test.skipIf(!!scriptSkipReason)(
  "they answer as plain Bun does",
  async () => {
    const { stdout, stderr, exitCode } = await run(
      [python!, join(import.meta.dir, "shell", "quick.py"), ...programs],
      undefined,
      scriptEnvironment(),
    );
    expect(stderr).toBe("");
    expect(withoutTodo(stdout).lines.filter(line => !/^[^ ]+: same \([0-9]+ lines\)$/.test(line))).toEqual([]);
    expect(exitCode).toBe(0);
  },
  290_000,
);

for (const heat of ["hot", "cold", "neither"]) {
  test.skipIf(!!scriptSkipReason)(
    `they answer the same with every function ${heat}`,
    async () => {
      const { stdout, stderr, exitCode } = await run(
        [python!, join(import.meta.dir, "shell", "heat.py"), heat, ...programs],
        undefined,
        scriptEnvironment(),
      );
      const { lines, todo } = withoutTodo(stderr);
      expect(lines).toEqual([]);
      expect(stdout.split("\n").filter(line => line !== "")).toEqual([
        `${programs.length - todo} programs answer the same with every function ${heat}, 0 do not`,
      ]);
      expect(exitCode).toBe(0);
    },
    290_000,
  );
}
