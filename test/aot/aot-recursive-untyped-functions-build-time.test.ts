import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { test } from "./supported";

const functionCount = isDebug || isASAN ? 2_000 : 16_000;
const timeout = isDebug || isASAN ? 240_000 : 20_000;

function recursiveFunctions() {
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

test(
  "build time is linear in the number of mutually recursive untyped functions",
  async () => {
    using dir = tempDir("aot-recursive-untyped", {
      "recursive.js": recursiveFunctions(),
      "main.ts": `import { result } from "./recursive.js";\nexport const total = result;\n`,
    });
    await using checked = Bun.spawn({
      cmd: [bunExe(), "check", "--aot", "./main.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      checked.stdout.text(),
      checked.stderr.text(),
      checked.exited,
    ]);
    expect({ output: exitCode ? stdout + stderr : "", exitCode }).toEqual({ output: "", exitCode: 0 });
  },
  timeout,
);
