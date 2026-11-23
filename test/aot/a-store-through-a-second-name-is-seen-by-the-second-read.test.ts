import { expect } from "bun:test";
import { realpathSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { shapes } from "./a-store-through-a-second-name-shapes";
import { built, spawned } from "./harness/commands";
import { test } from "./supported";

const shapesInOneProgram = 100;
const lanes = [
  ["as users build", []],
  ["under the verifier", ["--aot-check=Validate"]],
] as const;

for (const isSloppy of [false, true]) {
  const drawn = shapes().filter(shape => shape.isSloppy === isSloppy);
  for (let first = 0; first < drawn.length; first += shapesInOneProgram) {
    const together = drawn.slice(first, first + shapesInOneProgram);
    for (const [lane, flags] of lanes)
      test.concurrent(`${together[0].name} and the ${together.length - 1} behind it, ${lane}`, async () => {
        const file = isSloppy ? "main.cjs" : "main.mjs";
        using dir = tempDir("a-store-through-a-second-name", {
          [file]: together.map(({ text }) => `{\n${text}}\n`).join(""),
        });
        const root = realpathSync(String(dir));
        const executable = join(root, "program");
        built(
          await spawned(
            [bunExe(), "build", "--compile", "--aot", ...flags, file, "--outfile", executable],
            root,
            bunEnv,
          ),
        );
        const plain = await spawned([bunExe(), file], root, bunEnv);
        const compiled = await spawned([executable], root, bunEnv);
        expect(plain.stdout.trimEnd().split("\n")).toHaveLength(together.length);
        expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
      });
  }
}
