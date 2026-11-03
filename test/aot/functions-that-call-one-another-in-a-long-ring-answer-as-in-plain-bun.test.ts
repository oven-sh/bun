// What an untyped parameter is used as is asked of the function that it is handed on to, and so on. Where ten thousand functions each call the next and the
// last calls the first, the way round is longer than the stack of the thread that follows it: nothing of it was kept, so every parameter of the program
// cost the build as much as the longest walk there is, and the build of this program took a minute.
import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, spawned } from "./harness/commands";
import { test } from "./supported";

setDefaultTimeout(600_000);

const length = 10_000;
const ring = (name: string, handedOn: string) =>
  Array.from(
    { length },
    (_, index) =>
      `function ${name}${index}(value, steps) {\n` +
      `  if (steps === 0 || value.rest === null) return value.own${index % 8};\n` +
      `  return value.own${index % 8} + ${name}${(index + 1) % length}(${handedOn}, steps - 1);\n}\n`,
  ).join("");
const program =
  ring("whole", "value") +
  ring("part", "value.rest") +
  `let list = null;
for (let index = 0; index < 40; index++) {
  list = { own0: index, own1: index * 2, own2: 0.5, own3: -index, own4: 4, own5: index % 3, own6: 6, own7: 1e9, rest: list };
}
console.log(whole0(list, 1500), whole7(list, 3), whole${length - 1}(list, 2), whole4321(list, 0));
console.log(part0(list, 1500), part7(list, 3), part${length - 1}(list, 2), part4321(list, 39));
`;

test("each function hands what it gets, or a part of it, to the next", async () => {
  using folder = tempDir("aot-long-ring", { "main.js": program });
  const cwd = String(folder);
  const executable = join(cwd, isWindows ? "main.exe" : "main");
  built(await spawned([bunExe(), "build", "--compile", "--aot", "./main.js", "--outfile", executable], cwd, bunEnv));
  const compiled = await spawned([executable], cwd, bunEnv);
  const plain = await spawned([bunExe(), "./main.js"], cwd, bunEnv);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  expect(plain.stdout.trim().split("\n")).toHaveLength(2);
});
