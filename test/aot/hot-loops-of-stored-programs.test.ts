// The loops of perf/everyday/loops-over-lists-and-typed-arrays.txt are pinned by instruction counts, which need hardware counters that most CI machines
// do not have. This test needs none and runs nothing: the front end writes each program, testaot generates code for it (`lower-to-air loops`), and the hot
// loop must be the one that perf/hot-loops.json describes: by how much its counter steps, which says how often it was unrolled, and how many Air
// instructions and patchpoints it has. A bounds check, a poll, a conversion or a spill that gets into the loop changes the numbers.
//
// A number may go down: write the new one into perf/hot-loops.json. AOT_HOT_LOOPS_OUTPUT=<folder> keeps each program's .ir file, and
// `testaot run <file> --show-output` prints the Air of its loops. In the engine, aot/tests/codegen/typed-array-loops has the same loops with their B3.
import { expect } from "bun:test";
import { bunEnv, bunExe, isArm64, isASAN, isLinux, tempDir } from "harness";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { withProgramOutput } from "./harness/flags";
import { describe, test } from "./harness/printed-ir";
import { everydayIdioms } from "./perf/everyday-idioms";
import hotLoops from "./perf/hot-loops.json";
import { writeTypedIdioms } from "./perf/untyped-idioms";
import { slot, spawned } from "./run-programs";
import { testaot, toolEnv } from "./shell/tools";

const group = "everyday-loops-over-lists-and-typed-arrays/";
const programs = everydayIdioms()
  .filter(({ name }) => name.startsWith(group))
  .map(({ name, text }) => ({ name: name.slice(group.length), text }));

type Size = { instructions: number; patchpoints: number };
/** `step` is null for a loop without a single counter: then it is the first loop of the function. */
type HotLoop = { function: string; step: number | null; x64: Size; arm64: Size };

// `loop #8, instructions: 10, patchpoints: 8, %rcx steps by 8`, under `function f3 name="turn" role=Source`. A copy of the function with another role is for other callers.
function loopsOf(output: string, functionName: string) {
  const loops: (Size & { steps: number[] })[] = [];
  let isInFunction = false;
  for (const line of output.split("\n")) {
    if (line.startsWith("function ")) isInFunction = line.endsWith(` name="${functionName}" role=Source`);
    const loop = isInFunction && /^loop #\d+, instructions: (\d+), patchpoints: (\d+)(.*)$/.exec(line);
    if (loop)
      loops.push({
        instructions: Number(loop[1]),
        patchpoints: Number(loop[2]),
        steps: [...loop[3].matchAll(/ steps by (-?\d+)/g)].map(step => Number(step[1])),
      });
  }
  return loops;
}

// The numbers were read on Linux: other systems differ in how a loop polls. With a sanitizer compiled code checks each access.
describe.skipIf(!isLinux || isASAN)("the hot loop of", () => {
  test("every program of the group has an entry", () => {
    expect(Object.keys(hotLoops).sort()).toEqual(programs.map(({ name }) => name).sort());
  });

  test.concurrent.each(programs)("$name", async ({ name, text }) => {
    const expected: HotLoop = hotLoops[name as keyof typeof hotLoops];
    using dir = tempDir("aot-hot-loops", {});
    const folder = String(dir);
    writeTypedIdioms(folder);
    const source = join(group, name + ".ts");
    mkdirSync(dirname(join(folder, source)), { recursive: true });
    writeFileSync(join(folder, source), text);

    const output = await slot(async () => {
      const compiled = await spawned([bunExe(), "compile", withProgramOutput("program.aot"), source], folder, bunEnv);
      expect({ stderr: compiled.stderr, exitCode: compiled.exitCode }).toEqual({
        stderr: expect.any(String),
        exitCode: 0,
      });
      const printed = await spawned([testaot!, "print", "program.aot"], folder, toolEnv);
      expect({ stderr: printed.stderr, exitCode: printed.exitCode }).toEqual({
        stderr: expect.any(String),
        exitCode: 0,
      });

      const program = printed.stdout.replaceAll("\r\n", "\n");
      const id = new RegExp(`^function (f\\d+) name="${expected.function}"`, "m").exec(program)?.[1];
      expect(id).toBeDefined();
      const file = join(process.env.AOT_HOT_LOOPS_OUTPUT ?? folder, name + ".ir");
      const directives = ["# FORM: AsRead", "# LIBRARY: own", `# RUN: lower-to-air loops ${id}`, "# CHECK: function"];
      writeFileSync(file, [...directives, program].join("\n"));
      // The exit code also speaks of the notes that a build of the library gives, which are no matter of this test.
      return (await spawned([testaot!, "run", file, "--show-output"], folder, toolEnv)).stdout.replaceAll("\r\n", "\n");
    });

    const loops = loopsOf(output, expected.function);
    const hotLoop = expected.step === null ? loops[0] : loops.find(({ steps }) => steps.includes(expected.step!));
    expect({ step: expected.step, loop: hotLoop, allLoops: loops }).toEqual({
      step: expected.step,
      loop: expect.objectContaining(isArm64 ? expected.arm64 : expected.x64),
      allLoops: expect.any(Array),
    });
  });
});
