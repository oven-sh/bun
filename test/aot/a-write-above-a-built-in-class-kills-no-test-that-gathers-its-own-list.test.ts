import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// A body that makes a list or a table, fills it in a loop and returns it. In an executable the compiler holds such a receiver to the mark of its cell.
// In a test run any member above it may be replaced and put back, also by another file, and the receiver is as good as before.
async function runTests(directory: string, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--timeout=60000", ...flags], directory, bunEnv);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  return { stdout, results, exitCode };
}

async function expectCompiledToRunAsPlain(files: Record<string, string>) {
  using dir = tempDir("a-write-above-a-built-in-class", files);
  const plain = await runTests(String(dir));
  expect(plain.results.filter(result => result.startsWith("fail"))).toEqual([]);
  expect(plain.results).not.toEqual([]);
  expect(await runTests(String(dir), "--aot")).toEqual(plain);
}

test("a neighbor of push is replaced and put back between two runs of a loop that pushes", async () => {
  await expectCompiledToRunAsPlain({
    "gathers.test.ts": `
      import { test } from "bun:test";
      function gather(count: number, change: (k: number) => number): number[] {
        const result: number[] = [];
        for (let k = 0; k < count; k++) result.push(change(k));
        return result;
      }
      const changes = [(k: number) => k * 2, (k: number) => k + 1];
      test("in front of the write", () => console.log("A " + gather(3, changes[0]).join()));
      test("flat is replaced and put back", () => {
        const original = Array.prototype.flat;
        Array.prototype.flat = function () { return ["mine"] as any; } as any;
        console.log("B " + ([1, [2]] as any).flat().join());
        Array.prototype.flat = original;
      });
      test("behind the write", () => {
        console.log("C " + gather(300, changes[1]).length);
        console.log("D " + gather(4, changes[0]).join());
      });`,
  });
});

test("get is replaced and put back between two runs of a loop that sets", async () => {
  await expectCompiledToRunAsPlain({
    "tables.test.ts": `
      import { test } from "bun:test";
      function index(words: string[]): Map<string, number> {
        const places = new Map<string, number>();
        for (let k = 0; k < words.length; k++) places.set(words[k], k);
        return places;
      }
      const words = ["red", "green", "blue"];
      test("in front", () => console.log("A " + index(words).size));
      test("get is replaced and put back", () => {
        const original = Map.prototype.get;
        Map.prototype.get = function () { return -1 as any; };
        console.log("B " + new Map([["x", 5]]).get("x"));
        Map.prototype.get = original;
      });
      test("behind", () => console.log("C " + index(words).size + " " + index(words).get("blue")));`,
  });
});

test("one file lays a name on Object.prototype and deletes it, and another file gathers a list", async () => {
  await expectCompiledToRunAsPlain({
    "a.test.ts": `
      import { test } from "bun:test";
      test("pollution is looked for", () => {
        (Object.prototype as any).polluted = "yes";
        console.log("A " + ({} as any).polluted);
        delete (Object.prototype as any).polluted;
      });`,
    "b.test.ts": `
      import { test } from "bun:test";
      import { collect } from "./product";
      const steps = [(k: number) => "r" + k, (k: number) => "s" + k];
      test("another file", () => console.log("B " + collect(300, steps[1]).length + " " + collect(2, steps[0]).join()));`,
    "product.ts": `
      export function collect(count: number, step: (k: number) => string): string[] {
        const out: string[] = [];
        for (let k = 0; k < count; k++) out.push(step(k));
        return out;
      }`,
  });
});
