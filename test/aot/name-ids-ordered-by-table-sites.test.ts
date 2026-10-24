import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "main.js": `const settings = { seldom: 1 };
settings.seldom = 2;
settings.seldom = settings.seldom + settings.seldom;
settings.seldom = settings.seldom + 1;
function read(o) { return o.often; }
let total = 0;
const made = [];
for (let i = 0; i < 100; i++) {
  made.push(i & 1 ? { often: i } : { other: 1, often: i });
  total += read(made[i]);
}
console.log(total, settings.seldom, made.length);
`,
};

test("bun run --aot: a name read in a function has a lower number than a name that only code that runs once uses, however often", async () => {
  using dir = tempDir("aot-names-are-numbered-by-sites", files);
  const mapPath = join(String(dir), "main.map");
  const { stdout, stderr, exitCode } = await run([bunExe(), "run", "--debug-aot", "./main.js"], String(dir), {
    ...bunEnv,
    BUN_JSC_crashIfInterpreterIsUsed: "1",
    BUN_JSC_aotMapFilePath: mapPath,
  });
  expect(stderr).not.toContain("crashIfInterpreterIsUsed");
  expect({ stdout, exitCode }).toEqual({ stdout: "4950 5 100\n", exitCode: 0 });
  const numbers = new Map<string, number>();
  for (const line of readFileSync(mapPath, "utf8").split("\n")) {
    const fields = line.split("\t");
    if (fields[0] === "I") numbers.set(fields[2], Number(fields[1]));
  }
  expect({ often: numbers.has("often"), seldom: numbers.has("seldom") }).toEqual({ often: true, seldom: true });
  expect(numbers.get("often")!).toBeLessThan(numbers.get("seldom")!);
});
