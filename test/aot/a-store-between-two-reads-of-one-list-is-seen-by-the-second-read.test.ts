// `const x = a[i]; a[j] = ..; s += a[i] - x`, where i and j may meet. A typed turn over a list of whole numbers once loaded its elements
// under one name for the memory and stored them under another, so the load from in front of the store was handed out again behind it:
// plain Bun 31, compiled 0, no stop, the list itself right. 79 of these shapes answered wrongly then, as many built a hundred to a
// program as built alone. Under the verifier, which reads again what is handed out a second time, they end in a trap.
import { expect } from "bun:test";
import { realpathSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { shapes } from "./a-store-between-two-reads-of-one-list-shapes";
import { built, spawned } from "./harness/commands";
import { test } from "./supported";

const shapesInOneProgram = 100;
const lanes = [
  ["as users build", []],
  ["under the verifier", ["--aot-check=Validate"]],
] as const;

for (const typed of [true, false]) {
  const drawn = shapes().filter(shape => shape.typed === typed);
  for (let first = 0; first < drawn.length; first += shapesInOneProgram) {
    const together = drawn.slice(first, first + shapesInOneProgram);
    for (const [lane, flags] of lanes)
      test.concurrent(`${together[0].name} and the ${together.length - 1} behind it, ${lane}`, async () => {
        const file = typed ? "main.ts" : "main.js";
        const text = together
          .map(({ name, text }) => `{\n${text.replace("console.log(", `console.log(${JSON.stringify(name)}, `)}}\n`)
          .join("");
        using dir = tempDir("a-store-between-two-reads", { [file]: text });
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
