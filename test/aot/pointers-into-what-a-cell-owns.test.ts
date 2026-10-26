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

const source = join(
  import.meta.dir,
  "programs",
  "collector",
  "a-word-is-read-in-front-of-a-call-that-makes-a-text-and-used-behind-it.ts",
);

async function placesNamedWith(...flags: string[]) {
  using folder = tempDir("aot-pointers-into-what-a-cell-owns", {});
  const { stderr, exitCode } = await slot(() =>
    spawned(
      [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        "--aot-check=validate-references",
        ...flags,
        source,
        "--outfile",
        join(String(folder), "program"),
      ],
      join(source, ".."),
      bunEnv,
    ),
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
