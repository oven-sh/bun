// What the files test/aot/test-run-in-parts*.test.ts all use.
import { bunEnv, bunExe } from "harness";
import { run } from "./run";

export const passing = (name: string, seen = "lib") => `import { test, expect } from "bun:test";
import { value } from "./lib";
test("${name}", () => {
  expect(value + (globalThis as any).fromPreload).toBe(3);
  console.log("${name} ran with ${seen}");
});
`;
export const files: Record<string, string> = {
  // What is looked through for imports ahead of a build takes the text for one. Nothing is said about it.
  "lib.ts": `export const value: number = 1;\nexport const prose = 'it comes from "./${"a long way off ".repeat(20)}/here", they say';`,
  "preload.ts": `(globalThis as any).fromPreload = 2;`,
  "a.test.ts": passing("a"),
  "b.test.ts": passing("b"),
  "c.test.ts": passing("c"),
  "d.test.ts": passing("d") + `test.skip("d skipped", () => {});\n`,
  "e.test.ts": passing("e") + `test("e fails", () => { expect(1).toBe(2); });\n`,
  "f.test.ts": passing("f"),
  "g.test.ts": `import { nothing } from "./no-such-file";\nconsole.log(nothing);\n${passing("g")}`,
};

export const twoFiles = "TestRunLayers:2,TestRunPartFiles:2";
export const envOf = (words?: string) => (words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv);

export async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run(
    [bunExe(), "test", "--preload", "./preload.ts", ...flags],
    directory,
    envOf(words),
  );
  const results = [...stderr.matchAll(/^\((pass|fail|skip)\) (.*?)(?: \[.*\])?$/gm)].map(
    match => `${match[1]} ${match[2]}`,
  );
  const count = (word: string) => stderr.match(new RegExp(`^ *(\\d+) ${word}$`, "m"))?.[1];
  return {
    stdout: stdout
      .split("\n")
      .filter(line => line.includes(" ran with ") || line.startsWith("error"))
      .sort(),
    results: results.sort(),
    ran: stderr.match(/^Ran \d+ tests? across \d+ files?/m)?.[0],
    saysOfFolders: stderr.match(/^.*Cannot read directory.*$/m)?.[0],
    pass: count("pass"),
    skip: count("skip"),
    fail: count("fail"),
    exitCode,
  };
}
