// With --isolate every test file has a realm of its own, and what it imports is evaluated anew. An object can outlive its file all the same: `Bun.s3` is one object for
// the whole process, and what a file hangs on it is there for the next. For the next file it is an object of a class that is gone: no instance of the class of that
// name which the file has imported. Where the run is built in layers the two classes are one class of one program, with one layout, so the compiled `instanceof` has to
// ask for the realm too. For some hours it did not.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const asks = `
  import { expect, test } from "bun:test";
  import { Box, isBox } from "./box.ts";
  test("what the file before left", () => {
    const left = (Bun.s3 as any).left;
    (Bun.s3 as any).left = new Box(5);
    console.error("LEFT", left === undefined ? "nothing" : [left instanceof Box, isBox(left), isBox(new Box(1))].join());
  });`;
const files = {
  "box.ts": `
    export class Box { size: number; constructor(size: number) { this.size = size; } }
    export function isBox(value: unknown) { return value instanceof Box; }`,
  "a.test.ts": asks,
  "b.test.ts": asks,
};

async function linesOf(flags: string[], words?: string) {
  using dir = tempDir("aot-an-object-outlives-its-test-file", files);
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  await using run = Bun.spawn({
    cmd: [bunExe(), "test", ...flags, "--isolate"],
    cwd: String(dir),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
  return { lines: stderr.split("\n").filter(line => line.startsWith("LEFT")), exitCode };
}

test("in a run of two layers, as in bun test", async () => {
  const plain = await linesOf([]);
  expect(plain).toEqual({ lines: ["LEFT nothing", "LEFT false,false,true"], exitCode: 0 });
  expect(await linesOf(["--aot"], "TestRunLayers:2")).toEqual(plain);
}, 240_000);
