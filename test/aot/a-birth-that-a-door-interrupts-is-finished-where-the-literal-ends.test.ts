import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawned } from "./harness/commands";
import { describe, test } from "./supported";

// act() fills a record between calls: `owner: this.name` goes into a slot that is held to texts, off a `this` that nobody has typed, so the store stands behind a test whose rare side defines the name by the long way and comes back.
// Behind it the walk cannot finish the birth by what it knows. The record bore the mark of its birth for life, and the constructor that takes it apart read all six names by the long way.
const program = readFileSync(
  join(
    import.meta.dir,
    "parallel",
    "records-born-between-calls",
    "a-book-of-orders-whose-records-are-filled-between-calls.cjs",
  ),
  "utf8",
);

describe("records that are filled between calls", () => {
  test("a birth that a door interrupts is finished where the literal ends", async () => {
    using dir = tempDir("aot-births-that-doors-interrupt", { "main.cjs": program });
    const root = String(dir);
    const build = await spawned([bunExe(), "compile", "./main.cjs", "--explain=statistics"], root, bunEnv);
    const count = (name: string) => Number(new RegExp(`^${name} (\\d+)$`, "m").exec(build.stderr)?.[1]);
    const ran = await spawned([join(root, isWindows ? "main.exe" : "main"), "5"], root, bunEnv);
    const plain = await spawned([bunExe(), "./main.cjs", "5"], root, bunEnv);
    expect({
      exitCode: build.exitCode,
      birthsFinishedWhereLiteralsEnd: count("AllocationsFinishedAtLiteralEnds") > 0,
      stdout: ran.stdout,
    }).toEqual({
      exitCode: 0,
      birthsFinishedWhereLiteralsEnd: true,
      stdout: plain.stdout,
    });
  });
});
