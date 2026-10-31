import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// `Object.keys(null)` throws "null is not an object (evaluating 'Object.keys(null)')". A test run has the files of the program beside it, so it quotes the call
// in functions that an executable keeps no text of, too: `helper` is reached by calls alone.
const program = readFileSync(
  join(import.meta.dir, "parallel", "errors", "native-function-that-refuses-its-argument-quotes-the-call.js"),
  "utf8",
);
const files = {
  "package.json": `{ "type": "module" }`,
  "src/helper.ts": `function helper<T>(run: () => T): T[] { return [run()]; }
export function tried(name: string, run: () => unknown) {
  try {
    helper(run);
  } catch (error) {
    console.log(name + ":", (error as Error).message);
  }
}
export const inShared = (value: unknown) => [Object.keys(value as object)];
`,
  "shapes.test.js": `import { test } from "bun:test";\n${program}\ntest("shapes", () => {});\n`,
  "helper.test.ts": `import { test } from "bun:test";
import { inShared, tried } from "./src/helper";
let absent: any;
test("helper", () => {
  tried("the callback leaves by a tail call", () => Object.keys(null as any));
  tried("behind a type", () => { const lists: string[][] = [Object.keys(absent as object)]; return lists; });
  tried("in a file of the project", () => [inShared(null)]);
});
`,
};

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr);
  return { stdout: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")), exitCode };
}

for (const [way, words] of [
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
]) {
  test(`a native function that refuses its argument quotes the call, ${way}`, async () => {
    using dir = tempDir("aot-native-function-quotes-the-call", files);
    const plain = await runTests(String(dir), undefined);
    expect(plain.exitCode).toBe(0);
    expect(plain.stdout).toContain("a path: TypeError: null is not an object (evaluating 'o.deep.keys(null)')");
    expect(plain.stdout).toContain("the callback leaves by a tail call: null is not an object (evaluating 'run()')");
    expect(await runTests(String(dir), words, "--aot")).toEqual(plain);
  }, 120_000);
}
