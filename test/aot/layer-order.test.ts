import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "./supported";

const imports = [
  `import { a } from "a";`,
  `import { b } from "b";`,
  `import { x } from "./src/x";`,
  `import { y } from "./src/y";`,
];
const body = `test("t", () => { expect([a(), b(), x(), y()].join()).toBe("a,b,x,y"); });\n`;
const other = `import { test, expect } from "bun:test";\nimport { b } from "b";\nimport { y } from "./src/y";\ntest("u", () => { expect(b() + y()).toBe("by"); });\n`;

async function hashesOf(dir: string, lines: string[], names: [string, string]) {
  for (const name of readdirSync(dir)) if (name.endsWith(".test.ts")) rmSync(join(dir, name));
  writeFileSync(join(dir, names[0]), `import { test, expect } from "bun:test";\n${lines.join("\n")}\n${body}`);
  writeFileSync(join(dir, names[1]), other);
  await using run = Bun.spawn({
    cmd: [bunExe(), "test", "--aot", "--isolate"],
    cwd: dir,
    env: { ...bunEnv, BUN_JSC_logAOTPhaseTimes: "1", BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
  const hashes: Record<string, string> = {};
  let last = "";
  for (const line of stderr.split("\n")) {
    const program = line.match(/^AOT part build \| the program \| (\d+ bytes \| hash \w+)/);
    const label = line.match(/^AOT part build \| ([^|]+) \| wall /);
    if (program) last = program[1];
    else if (label && label[1] !== "test files" && last) [hashes[label[1]], last] = [last, ""];
  }
  return { exitCode, hashes };
}

test("a layer follows what the test files import, not the order in which they name it", async () => {
  using folder = tempDir("aot-layer-order", {
    "package.json": `{ "name": "p" }`,
    "node_modules/a/package.json": `{ "name": "a", "main": "index.js" }`,
    "node_modules/a/index.js": `exports.a = () => "a";\n`,
    "node_modules/b/package.json": `{ "name": "b", "main": "index.js" }`,
    "node_modules/b/index.js": `exports.b = () => "b";\n`,
    "src/x.ts": `export const x = () => "x";\n`,
    "src/y.ts": `export const y = () => "y";\n`,
  });
  const dir = String(folder);
  const written = await hashesOf(dir, imports, ["a.test.ts", "b.test.ts"]);
  expect(written.exitCode).toBe(0);
  expect(Object.keys(written.hashes)).toEqual(["the packages that test files share", "what test files share"]);
  expect(await hashesOf(dir, imports, ["a.test.ts", "b.test.ts"])).toEqual(written);
  expect(await hashesOf(dir, imports.toReversed(), ["a.test.ts", "b.test.ts"])).toEqual(written);
  expect(await hashesOf(dir, imports, ["z.test.ts", "b.test.ts"])).toEqual(written);
}, 240_000);
