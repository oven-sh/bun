import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// The compile step of `bun test --aot` crashed on this file, in the back end's UnrollLoops: see parallel/untyped-loops/loop-whose-comparison-another-block-reads.js.
const files = {
  "tsconfig.json": `{"compilerOptions":{"target":"esnext","module":"preserve","moduleResolution":"bundler","allowJs":true,"noEmit":true,"strict":true,"types":[],"allowImportingTsExtensions":true}}`,
  "a.test.ts": `import { test } from "bun:test";
function own<E>(e: Iterable<E>): Iterable<E> { return { [Symbol.iterator]() { const i = e[Symbol.iterator](); return { next() { return i.next(); }, return(v?: any) { return i.return ? i.return(v) : { done: true, value: v }; } }; } }; }
const K: number[] = JSON.parse("[0,1]");
const A = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), log: string[] = [];
function v0(): string {
  for (let hot = 0; hot < (K[1] | 0); hot++) {
    function k(a: Uint8Array): any { let n = 0; for (let i = 0; i < a.length; i++) n += a[i] * a[i]; }
    for (const t of own([2, 4, 9, 3])) { const n: any = k(A.subarray(0, t)); log.push(String(n)); }
  }
  return log.join(" ");
}
console.log("SEEN " + v0());
test("a", () => {});
`,
};

test("the test file is compiled and runs as under bun test", async () => {
  using dir = tempDir("aot-loop-comparison-in-another-block", files);
  const answers = [];
  for (const flags of [[], ["--aot"]]) {
    const ran = await run([bunExe(), "test", ...flags, "./a.test.ts"], String(dir), bunEnv);
    answers.push({ seen: ran.stdout.split("\n").filter(line => line.startsWith("SEEN ")), exitCode: ran.exitCode });
  }
  expect(answers[0]).toEqual({ seen: ["SEEN undefined undefined undefined undefined"], exitCode: 0 });
  expect(answers[1]).toEqual(answers[0]);
}, 120_000);
