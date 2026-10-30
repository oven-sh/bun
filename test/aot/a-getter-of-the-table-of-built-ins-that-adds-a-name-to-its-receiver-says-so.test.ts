// The compiler takes a getter of the table of built-ins to leave its receiver with the own keys it had, unless the row of the getter says otherwise. built-ins-alone/getters-and-their-receivers.ts
// reads every getter of every prototype object that it can reach, in a process of its own: on an instance, on a plain object below the prototype, and by Reflect.get() with a plain object as the
// receiver. A getter that the table lists and that leaves its receiver with another own key has a row that says so.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { join } from "path";
import type { GettersFound } from "./built-ins-alone/getters-and-their-receivers";
import { findBuiltinTable } from "./harness/builtin-table";
import { test } from "./supported";

const table = findBuiltinTable(bunExe());

// The expressions that make the instances name commands and paths of POSIX.
test.skipIf(table === undefined || isWindows)(
  "a getter of the table of built-ins that adds a name to its receiver has a row that says so",
  () => {
    const { stdout, stderr, exitCode } = Bun.spawnSync({
      cmd: [
        bunExe(),
        "--expose-internals",
        join(import.meta.dir, "built-ins-alone/getters-and-their-receivers.ts"),
        table!,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const last = stdout.toString().trimEnd().split("\n").at(-1)!;
    if (!last.startsWith("{")) throw new Error(stderr.toString().slice(-4000));
    const found = JSON.parse(last) as GettersFound;
    expect(found.added.filter(each => each.rowSaysSo === false)).toEqual([]);
    // The getters of the dates of a Stats keep what they made on their receiver, and their rows say so: the reads do see a key that appears.
    const isDateOfStats = (path: string) => path.endsWith("Stats%.prototype.mtime");
    expect(found.added.some(each => isDateOfStats(each.path) && each.on === "plain" && each.rowSaysSo === true)).toBe(
      true,
    );
    expect(found.read).toBeGreaterThan(400);
    expect(exitCode).toBe(0);
  },
  600_000,
);
