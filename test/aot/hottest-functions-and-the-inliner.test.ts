// The hottest functions of a program (hottest-functions.test.ts) are compiled in the forms for hot code, but what is copied into them is decided as for any function: by loops and
// by the calls out of loops. A helper of a dozen operations stays a call in a function that no loop calls directly, and is copied into one that a loop calls.
import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { run } from "./harness/run";
import { test } from "./supported";

const helper = (name: string) =>
  `function ${name}(a, b) { return (a * 3 + b * 5 - (a ^ b)) * 7 + (a & b) - (a | 1) + (b >> 1); }\n`;
const program = `${helper("helperOfOneCalledByValue")}${helper("helperOfOneCalledFromLoop")}
function calledByValue(o) { return helperOfOneCalledByValue(o.alpha, o.beta) + 1; }
function calledFromLoop(o) { return helperOfOneCalledFromLoop(o.alpha, o.beta) + 2; }
const all = [calledByValue, calledFromLoop];
let total = 0;
for (let turn = 0; turn < 5; turn++) {
  for (const each of all) total += each({ alpha: turn, beta: 3 });
  total += calledFromLoop({ alpha: turn, beta: 4 });
}
console.log(total);
`;

// TODO: the map of the build lists neither function, so their heat cannot be read.
test.todo(
  "a helper stays a call in one of the hottest functions and is copied into a function that a loop calls",
  async () => {
    using dir = tempDir("aot-hottest-functions-and-the-inliner", { "main.js": program });
    const cwd = String(dir);
    const executable = join(cwd, isWindows ? "main.exe" : "main");
    const map = join(cwd, "main.map");
    const built = await run([bunExe(), "build", "--compile", "--aot", "./main.js", "--outfile", executable], cwd, {
      ...bunEnv,
      BUN_JSC_aotMapFilePath: map,
    });
    expect({ output: built.exitCode ? built.stdout + built.stderr : "", exitCode: built.exitCode }).toEqual({
      output: "",
      exitCode: 0,
    });
    const plain = await run([bunExe(), "run", "./main.js"], cwd);
    expect(plain.exitCode).toBe(0);
    expect(await run([executable], cwd)).toEqual(plain);
    const heat = new Map<string, string>();
    for (const line of readFileSync(map, "utf8").split("\n")) {
      const fields = line.split("\t");
      if (fields[0] === "F" && !fields[8].startsWith("generic-")) heat.set(fields[7], fields[12]);
    }
    expect({ calledByValue: heat.get("calledByValue"), calledFromLoop: heat.get("calledFromLoop") }).toEqual({
      calledByValue: "h",
      calledFromLoop: "h",
    });
    expect({
      ofOneCalledByValue: heat.has("helperOfOneCalledByValue"),
      ofOneCalledFromLoop: heat.has("helperOfOneCalledFromLoop"),
    }).toEqual({ ofOneCalledByValue: true, ofOneCalledFromLoop: false });
  },
  240_000,
);
