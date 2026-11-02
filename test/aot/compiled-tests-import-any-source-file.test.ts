import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "src/counter.ts": `
    let count = 0;
    export function increment(): number { return ++count; }
    export function unused(): string { return "unused"; }`,
  "src/user.ts": `
    import { increment } from "./counter";
    export function use(): number { return increment(); }`,
  "helpers/load.ts": `
    export class Loader {
      async load(path: string) { return { ...(await import(path)) }; }
    }`,
  "one.test.ts": `
    import { expect, test } from "bun:test";
    import { join } from "node:path";
    import { Loader } from "./helpers/load";
    import { use } from "./src/user";
    test("a helper imports a source file by a path made at run time", async () => {
      const name = ["coun", "ter"].join("");
      const counter = await new Loader().load(join(import.meta.dir, "src", name + ".ts"));
      console.log(use(), counter.increment(), use(), Object.keys(counter).sort().join());
      expect(counter.unused()).toBe("unused");
    });`,
};

async function runTests(directory: string, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, bunEnv);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  return { stdout, results, exitCode };
}

test("a compiled test run finds every source file by its path", async () => {
  using dir = tempDir("compiled-tests-import", files);
  const plain = await runTests(String(dir));
  expect(plain).toEqual({
    stdout: expect.stringContaining("1 2 3 increment,unused\n"),
    results: ["pass a helper imports a source file by a path made at run time"],
    exitCode: 0,
  });
  expect(await runTests(String(dir), "--debug-aot")).toEqual(plain);
}, 60_000);
