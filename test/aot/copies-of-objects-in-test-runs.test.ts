import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// Compiled code takes `Object.assign({ z: k }, source)` and `{ z: k, ...source }` apart, field by field. An assignment stores, and a store asks what stands above the literal: in a test run a name may be planted there.
// And a test may replace Object.assign() itself.

async function runTests(directory: string, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--timeout=60000", ...flags], directory, bunEnv);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  // A crash prints only there, and the comparison below would hide it.
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  return { stdout, results, exitCode };
}

async function expectCompiledToRunAsPlain(files: Record<string, string>) {
  using dir = tempDir("copies-of-objects-in-test-runs", files);
  const plain = await runTests(String(dir));
  expect(plain.results.filter(result => result.startsWith("fail"))).toEqual([]);
  expect(plain.results).not.toEqual([]);
  expect(await runTests(String(dir), "--aot")).toEqual(plain);
}

const app = {
  "app.ts": `
    export type Source = { mark: number; other: number };
    export type Made = { base: number; mark?: number; other?: number };
    export function assigned(base: number, source: Source): Made { return Object.assign<Made, Source>({ base }, source); }
    export function spread(base: number, source: Source): Made { return { base, ...source }; }
    export function copied(source: Source, base: number): Made { return { ...source, base }; }
    export function show(made: Made): string { return Object.keys(made).join() + " " + JSON.stringify(made); }`,
};

test("a setter and a read-only value are planted under a name of the source", async () => {
  await expectCompiledToRunAsPlain({
    ...app,
    "one.test.ts": `
      import { test } from "bun:test";
      import { assigned, copied, show, spread } from "./app";
      const all = (base: number) => { const source = { mark: base + 1, other: base + 2 }; let text = ""; for (const make of [() => assigned(base, source), () => spread(base, source), () => copied(source, base)]) { try { text += show(make()) + " . "; } catch (error) { text += (error as Error).name + " . "; } } return text; };
      test("a setter", () => {
        const taken: number[] = [];
        for (let turn = 0; turn < 3; turn++) console.log(all(turn));
        Object.defineProperty(Object.prototype, "mark", { set(v: number) { taken.push(v); }, get() { return -1; }, configurable: true });
        for (let turn = 0; turn < 3; turn++) console.log(all(turn), taken.join());
        delete (Object.prototype as any).mark;
        for (let turn = 0; turn < 3; turn++) console.log(all(turn), taken.join());
      });
      test("a value that is read-only", () => {
        Object.defineProperty(Object.prototype, "other", { value: 1, writable: false, configurable: true });
        for (let turn = 0; turn < 3; turn++) console.log(all(turn));
        delete (Object.prototype as any).other;
        for (let turn = 0; turn < 3; turn++) console.log(all(turn));
      });`,
  });
});

test("a test replaces Object.assign()", async () => {
  await expectCompiledToRunAsPlain({
    ...app,
    "one.test.ts": `
      import { spyOn, test } from "bun:test";
      import { assigned, show } from "./app";
      test("spied", () => {
        console.log(show(assigned(1, { mark: 2, other: 3 })));
        const spy = spyOn(Object, "assign").mockImplementation((target: any) => { target.spied = true; return target; });
        console.log(show(assigned(1, { mark: 2, other: 3 })), spy.mock.calls.length);
        spy.mockRestore();
        console.log(show(assigned(1, { mark: 2, other: 3 })));
      });`,
  });
});
