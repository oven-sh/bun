// For ../test-files-from-disk-reach-what-they-name*.test.ts: the project of most cases, and how they run it.
import { expect } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { run } from "./run";

export const sources = {
  "package.json": `{ "name": "suite", "type": "module" }`,
  "src/counter.ts": `let count = 0;
export function increment(): number { return ++count; }
export function reset(): void { count = 0; }
export function neverNamed(): string { return "never named"; }
export default function current(): number { return count; }
`,
  "src/shapes.ts": `export type Shape = { sides: number };
export const square: Shape = { sides: 4 };
export const triangle: Shape = { sides: 3 };
`,
  "src/clock.ts": `export function now(): number { return Date.now(); }
export function zone(): string { return "UTC"; }
`,
  "src/lazy.ts": `export const lazy = "lazy";`,
  "src/old.cjs": `module.exports = { old: () => "old" };`,
  "src/data.json": `{ "answer": 42 }`,
  "src/effects.ts": `(globalThis as any).effects = ((globalThis as any).effects ?? 0) + 1;`,
  "src/inner.ts": `let calls = 0;
export function inner(): number { return ++calls; }
`,
  "src/outer.ts": `import { inner } from "./inner";
export function outer(): number { return inner(); }
`,
};

export async function runTests(directory: string, env: Record<string, string>, ...flags: string[]) {
  const { stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags, "./tests"], directory, {
    ...bunEnv,
    ...env,
  });
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  return { results: results.sort(), exitCode, stderr };
}

export const fromDisk = { BUN_AOT_TEST_FILES_FROM_DISK: "1", BUN_AOT_TESTS_NAME_WHAT_THEY_USE: "1" };

export function standInOf(stderr: string, name = "bun-test-files-from-disk.js") {
  const printed = [...stderr.matchAll(/^AOT stand-in \| (.*)\n([^]*?)^AOT stand-in ends$/gm)];
  const last = printed.findLast(match => match[1].replaceAll("\\", "/").endsWith(`/node_modules/.cache/${name}`));
  expect(last).toBeDefined();
  return last![2];
}
