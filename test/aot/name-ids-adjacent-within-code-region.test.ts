import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const often = Array.from({ length: 2600 }, (_, i) => `often${i}`);
const seldom = Array.from({ length: 1200 }, (_, i) => `seldom${String(i).padStart(4, "0")}`);
const sumOf = (names: string[]) => names.map(name => `(o.${name} | 0)`).join(" + ");
const files = {
  "main.js": `function busy(o) { return ${sumOf(often)} + ${sumOf(often)}; }
function early(o) { return ${sumOf(seldom.filter((_, i) => i % 2 === 0))}; }
function late(o) { return ${sumOf(seldom.filter((_, i) => i % 2 === 1))}; }
let total = 0;
for (let i = 0; i < 3; i++) total += busy(JSON.parse('{"often7":' + i + "}")) + early(JSON.parse("{}")) + late(JSON.parse("{}"));
console.log(total);
`,
};

test("bun run --aot: name ids beyond the hot range are adjacent within a function", async () => {
  using dir = tempDir("aot-name-ids-adjacent", files);
  const mapPath = join(String(dir), "main.map");
  const { stdout, stderr, exitCode } = await run([bunExe(), "run", "--debug-aot", "./main.js"], String(dir), {
    ...bunEnv,
    BUN_JSC_crashIfInterpreterIsUsed: "1",
    BUN_JSC_aotMapFilePath: mapPath,
  });
  expect(stderr).not.toContain("crashIfInterpreterIsUsed");
  expect({ stdout, exitCode }).toEqual({ stdout: "6\n", exitCode: 0 });
  const numbers = new Map<string, number>();
  for (const line of readFileSync(mapPath, "utf8").split("\n")) {
    const fields = line.split("\t");
    if (fields[0] === "I") numbers.set(fields[2], Number(fields[1]));
  }
  const numbersOf = (isOdd: number) => seldom.filter((_, i) => i % 2 === isOdd).map(name => numbers.get(name) ?? NaN);
  const early = numbersOf(0),
    late = numbersOf(1);
  expect(Math.min(...early, ...late)).toBeGreaterThan(2047);
  expect(Math.max(...early) - Math.min(...early)).toBe(early.length - 1);
  expect(Math.max(...late) - Math.min(...late)).toBe(late.length - 1);
});
