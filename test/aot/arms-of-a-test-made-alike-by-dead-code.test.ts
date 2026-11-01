// EliminateDeadCode can leave the two arms of a test the same code. SimplifyControlFlow has to run again, and a build that verifies each pass says so if it does not.
// `next` of an array iterator has such arms once a caller keeps the iterator and another reads only `done`.
import { expect } from "bun:test";
import { rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { spawned } from "./harness/commands";
import { afterAll } from "./harness/declare";
import { compileCommand } from "./harness/flags";
import { describe, test } from "./supported";

const source = `
let kept;
function keep(i) {
  const list = ["a", "b", "c"];
  kept = i & 1 ? list.keys() : list.values();
}
function step() {
  const it = [1, , 3].values();
  let out = "";
  try {
    const r = it.next();
    if (r.value === 3) throw new Error("three");
    out += "t";
  } catch (e) {
    out += e.message;
  } finally {
    out += String(it.next().done);
  }
  return out;
}
let line = "";
for (let i = 0; i < 5000; i++) {
  keep(i);
  line = step();
}
console.log(line, String(kept.next().done));
`;

describe("compile/aot/arms of a test made alike by dead code", () => {
  const root = String(tempDir("aot-arms-made-alike", {}));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test("build with every pass verified", async () => {
    const program = join(root, "program.js");
    writeFileSync(program, source);
    const outfile = join(root, isWindows ? "program.exe" : "program");
    const build = await spawned(
      [bunExe(), ...compileCommand, "--aot-verify-each-pass", program, "--outfile", outfile],
      root,
      bunEnv,
    );
    expect(build.stderr + build.stdout).not.toContain("SkippedPassChangesFunction");
    expect(build.exitCode).toBe(0);
    const run = await spawned([outfile], root, bunEnv);
    expect(run.stdout).toBe("tfalse false\n");
    expect(run.exitCode).toBe(0);
  }, 60_000);
});
