// Of the functions that hold no read, store or method call by name, only those are among the hottest of a program (hottest-functions.test.ts) that call directly a function that holds one:
// what is copied into them needs its memory and its heat. A function that only computes is compiled as it would be anywhere.
import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { run } from "./harness/run";
import { test } from "./supported";

async function bytesOfFunctions(program: string, buildFlags: string[] = []) {
  using dir = tempDir("aot-hottest-functions", { "main.js": program });
  const cwd = String(dir);
  const executable = join(cwd, isWindows ? "main.exe" : "main");
  const map = join(cwd, "main.map");
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", ...buildFlags, "./main.js", "--outfile", executable],
    cwd,
    { ...bunEnv, BUN_JSC_aotMapFilePath: map },
  );
  expect({ output: built.exitCode ? built.stdout + built.stderr : "", exitCode: built.exitCode }).toEqual({
    output: "",
    exitCode: 0,
  });
  const plain = await run([bunExe(), "run", "./main.js"], cwd);
  expect(plain.exitCode).toBe(0);
  expect(await run([executable], cwd)).toEqual(plain);
  const bytes = new Map<string, number>();
  for (const line of readFileSync(map, "utf8").split("\n")) {
    const fields = line.split("\t");
    if (fields[0] === "F") bytes.set(fields[7], (bytes.get(fields[7]) ?? 0) + Number(fields[3]));
  }
  return bytes;
}

const callsEach = (names: string[], argument: string) =>
  `const all = [${names.join(", ")}];\nlet text = "";\nfor (let turn = 0; turn < 3; turn++) for (const each of all) text = String(String(each(${argument})).length + text.length);\nconsole.log(text);\n`;

// TODO: neither function is larger as built than in a build without hottest functions.
test.todo(
  "a function without an access by name is among the hottest only if it calls one directly that holds one",
  async () => {
    const program =
      `function reads(o) { return o.alpha; }
function callsOneThatReads(o) { return reads(o) + 1; }
function onlyComputes(o) { const text = "" + o; return text + 1.5 + (text < "m" ? "a" : "b") + text + (1 / 3); }
` + callsEach(["reads", "callsOneThatReads", "onlyComputes"], "{ alpha: 1 }");
    const asBuilt = await bytesOfFunctions(program);
    const outsideTheHottest = await bytesOfFunctions(program, ["--aot-heat=nothing-is-hottest"]);
    const grows = (name: string) => asBuilt.get(name)! > outsideTheHottest.get(name)!;
    expect({ reads: grows("reads"), callsOneThatReads: grows("callsOneThatReads") }).toEqual({
      reads: true,
      callsOneThatReads: true,
    });
    expect(asBuilt.get("onlyComputes")).toBe(outsideTheHottest.get("onlyComputes")!);
  },
  240_000,
);
