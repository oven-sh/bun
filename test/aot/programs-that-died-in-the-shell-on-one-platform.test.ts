// Programs that died of a signal in the `jsc` shell on one platform alone. Every run takes these. Where the shell dies of a signal on Linux,
// shell/quick.py says where (shell/where-it-died.py). shell/tools.ts says what the scripts need.
import { expect } from "bun:test";
import { join } from "path";
import { unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { run } from "./harness/run";
import { python, scriptEnvironment, scriptSkipReason } from "./shell/tools";

const programs = [
  // Linux on ARM64: signal 11, after the line "left early": an array is frozen in a loop, a store to it throws
  // and is caught there, and the run counts the calls of operations.
  "arrays/index-fill-grows-like-push",
  // Linux on x64, a shell built with assertions: signal 6 as they stand. A module of the image loads another
  // under a name that the program computes, and the shell took the path of the first for a URL.
  "modules/two-loads-module-cannot-linked-give",
  "structural-types/module-imported-by-computed-name-untyped",
  // Every platform: "console.log is not a function". After a store under a computed key of globalThis, `console` is the built-in or the
  // stored object, and compiled code tells them apart by identity. The shell had replaced `console` with an object of its own.
  "objects/accessors-getters-nobody-can-list",
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
