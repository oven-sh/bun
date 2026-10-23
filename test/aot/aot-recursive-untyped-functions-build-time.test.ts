import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { test } from "./supported";

const [few, many] = isDebug || isASAN ? [500, 2_000] : [4_000, 16_000];

function recursiveFunctions(functionCount: number) {
  let seed = 7;
  const nextCallee = () => (seed = (seed * 48_271) % 2_147_483_647) % functionCount;
  const functions = Array.from({ length: functionCount }, (_, index) => {
    const calls = [0, 1, 2].map(
      tag => `  if (node.tag === ${tag}) return f${nextCallee()}(node.next, depth + ${tag});\n`,
    );
    return `function f${index}(node, depth) {\n${calls.join("")}  return node.value;\n}\n`;
  });
  return `${functions.join("")}export const result = f0({ tag: 9, value: 1, next: null }, 0);\n`;
}

// Processor time, which does not depend on what else the machine is doing.
async function processorTimeOfCheck(functionCount: number) {
  using dir = tempDir("aot-recursive-untyped", {
    "recursive.js": recursiveFunctions(functionCount),
    "main.ts": `import { result } from "./recursive.js";\nexport const total = result;\n`,
  });
  await using checked = Bun.spawn({
    cmd: [bunExe(), "check", "--aot", "./main.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([checked.stdout.text(), checked.stderr.text(), checked.exited]);
  expect({ output: exitCode ? stdout + stderr : "", exitCode }).toEqual({ output: "", exitCode: 0 });
  return Number(checked.resourceUsage()!.cpuTime.total);
}

test("build time is linear in the number of mutually recursive untyped functions", async () => {
  const [timeOfFew, timeOfMany] = await Promise.all([processorTimeOfCheck(few), processorTimeOfCheck(many)]);
  expect(timeOfMany / timeOfFew).toBeLessThan((2 * many) / few);
}, 600_000);
