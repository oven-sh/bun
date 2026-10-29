import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const program = join(import.meta.dir, "contexts-of-node-vm-that-hold-promises-are-let-go", "main.cjs");

type Row = { name: string; bytesEach: number; heldWhileSuspended: number };

// A context takes over 40 KB and an answer 100 KB. The last scenario keeps every context it makes, and two of the suspended ones
// keep all 200 answers: they show that the numbers see what is kept.
function judge(rows: Row[]) {
  return rows.map(({ name, bytesEach, heldWhileSuspended }) => ({
    name,
    grows: bytesEach > 2048,
    holdsTheAnswers: heldWhileSuspended > 10_000_000,
  }));
}

test("a context of node:vm, its promises and what they were settled with are let go of as in bun run", async () => {
  using dir = tempDir("aot-contexts-of-node-vm-that-hold-promises", {});
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run([bunExe(), "build", "--compile", "--aot", program, "--outfile", executable], String(dir));
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });

  const [compiled, plain] = await Promise.all([
    run([executable], String(dir)),
    run([bunExe(), "run", program], String(dir)),
  ]);
  expect({ stderr: compiled.stderr, exitCode: compiled.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const rowsOf = (stdout: string): Row[] =>
    stdout
      .trim()
      .split("\n")
      .map(line => JSON.parse(line));

  const expected = rowsOf(plain.stdout).map(({ name }) => ({
    name,
    grows: name === "a reaction on an outer promise that never settles",
    holdsTheAnswers: name.endsWith("still need their answers"),
  }));
  expect(expected.length).toBe(27);
  expect(judge(rowsOf(plain.stdout))).toEqual(expected);
  expect(judge(rowsOf(compiled.stdout))).toEqual(expected);
}, 600_000);
