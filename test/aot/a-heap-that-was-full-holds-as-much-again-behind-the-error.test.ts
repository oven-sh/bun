// A program fills the range of its objects, catches the RangeError and lets go of everything. The next time it can hold as much again.
// It could not: on the way to a handler the registers of the handler's frame pass through a buffer on the stack, which the collector
// reads for references. What was left there, the list that had filled the heap, stayed alive until the next throw, so every second
// attempt ran out of memory almost at once.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, unsupported, withoutCoreDump } from "./run-programs";

const program = `type Tree = { left: Tree | null; right: Tree | null; id: number };
function build(depth: number, id: number): Tree | null {
  if (depth === 0) return null;
  return { left: build(depth - 1, id * 2), right: build(depth - 1, id * 2 + 1), id };
}
function size(tree: Tree | null): number {
  return tree ? 1 + size(tree.left) + size(tree.right) : 0;
}
function fill(): number {
  const keep: (Tree | null)[] = [];
  try {
    for (;;) keep.push(build(10, 1));
  } catch (error) {
    return error instanceof RangeError && size(keep[keep.length - 1]) === 1023 ? keep.length : -1;
  }
}
const counts: number[] = [];
for (let attempt = 0; attempt < 6; attempt++) counts.push(fill());
console.log("the first holds many:", counts[0] > 500);
console.log("each holds nine tenths of the first:", counts.map(count => count >= counts[0] * 0.9).join(" "));
`;

// A Bun built with AddressSanitizer keeps a block with newly dead cells out of allocation until the next collection.
test.skipIf(!!unsupported || isASAN)(
  "behind a caught RangeError for lack of memory the heap holds as much as before",
  async () => {
    await slot(async () => {
      using dir = tempDir("aot-full-heap-again", { "entry.ts": program, "tsconfig.json": "{}" });
      const folder = String(dir);
      const executable = join(folder, isWindows ? "entry.exe" : "entry");
      built(
        await spawned([bunExe(), "build", "--compile", "--aot", "entry.ts", "--outfile", executable], folder, bunEnv),
      );
      const ran = await spawned(withoutCoreDump([executable]), folder, {
        ...bunEnv,
        BUN_JSC_markedBlockCageSizeInMB: "64",
      });
      expect({ stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode, signal: ran.signal }).toEqual({
        stdout: "the first holds many: true\neach holds nine tenths of the first: true true true true true true\n",
        stderr: "",
        exitCode: 0,
        signal: null,
      });
    });
  },
  240_000,
);
