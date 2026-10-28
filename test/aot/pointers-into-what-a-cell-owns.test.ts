// Tests the check of pointers into what a cell owns: the storage of a view, the elements of an array, the characters of a string.
//
// Such a pointer keeps nothing. Wherever compiled code reads one behind a place where the collector can run, it has to read the cell behind that place too.
// --aot-check=validate-references asks this of the finished code of every function: registers are assigned, the frame is laid out, no instruction moves any more.
//
// --aot-testing=FoldLoadsPastCollections lets instruction selection fold a load into the instruction that uses it although a call that can run the collector stands between them.
// The read through the pointer then stands behind the call, and behind the last read of the cell. The check must name it.
// x64 alone has instructions that load one of their operands themselves.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";
import { join } from "node:path";
import { slot, spawned } from "./run-programs";
import { test } from "./supported";

const programs = join(import.meta.dir, "programs", "collector");

async function build(program: string, ...flags: string[]) {
  using folder = tempDir("aot-pointers-into-what-a-cell-owns", {});
  return await slot(() =>
    spawned(
      [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        "--aot-check=validate-references",
        ...flags,
        join(programs, program),
        "--outfile",
        join(String(folder), "program"),
      ],
      programs,
      bunEnv,
    ),
  );
}

async function placesNamedWith(...flags: string[]) {
  const { stderr, exitCode } = await build(
    "a-word-is-read-in-front-of-a-call-that-makes-a-text-and-used-behind-it.ts",
    ...flags,
  );
  return {
    exitCode,
    places: [...stderr.matchAll(/InnerPointerWithoutOwner: [^\n]*\((\w+)\) points into what a cell owns/g)].map(
      match => match[1],
    ),
  };
}

test("no pointer into what a cell owns outlives the cell", async () => {
  expect(await placesNamedWith()).toEqual({ exitCode: 0, places: [] });
});

// A Bun with the address sanitizer adds tests of its own to the code, and the check reads only code as a product gets it.
test.skipIf(process.arch !== "x64" || isASAN)(
  "a read through a pointer that is moved behind a call is named",
  async () => {
    const { exitCode, places } = await placesNamedWith("--aot-testing=FoldLoadsPastCollections");
    expect(exitCode).toBe(1);
    expect(places).toContain("GetTypedArrayElement");
  },
);

// The first access behind a test that a value is a cell takes the test over. The check still has to know which field that access reads.
// --aot-disable=b3:FoldTrapsIntoAccesses leaves each test where it stands, and the code holds the same pointers across the same places.
async function pointersHeldWith(...flags: string[]) {
  const { stderr, exitCode } = await build(
    "a-list-a-view-and-a-text-out-of-fields-that-may-hold-null-are-read-in-loops.ts",
    "--explain=statistics",
    ...flags,
  );
  return { exitCode, pointers: Number(/^InnerPointersAcrossSafepoints (\d+)$/m.exec(stderr)?.[1]) };
}

test.skipIf(process.arch !== "x64" || isASAN)(
  "a pointer is known although the access that loads it has taken over a test of its cell",
  async () => {
    const usual = await pointersHeldWith();
    expect(usual.exitCode).toBe(0);
    expect(usual.pointers).toBeGreaterThan(0);
    expect(await pointersHeldWith("--aot-disable=b3:FoldTrapsIntoAccesses")).toEqual(usual);
  },
);

// What takes a caught value from the run time is a place where the collector can run. In the first program nothing else stands between two reads through one pointer; the second is the first without its handlers.
async function pointersHeldIn(program: string) {
  const { stderr, exitCode } = await build(program, "--explain=statistics");
  return { exitCode, pointers: Number(/^InnerPointersAcrossSafepoints (\d+)$/m.exec(stderr)?.[1]) };
}

test.skipIf(process.arch !== "x64" || isASAN)("a pointer that is held across a handler alone is counted", async () => {
  expect({
    withHandlers: await pointersHeldIn("only-the-handler-stands-between-two-reads-through-one-pointer.ts"),
    without: await pointersHeldIn("nothing-stands-between-two-reads-through-one-pointer.ts"),
  }).toEqual({
    withHandlers: { exitCode: 0, pointers: 2 },
    without: { exitCode: 0, pointers: 0 },
  });
});
