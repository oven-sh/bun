import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// Compiled code runs an accessor that stands above an object directly, behind the guard of the class and the name. A test replaces such an accessor and gives it back.

async function runTests(directory: string, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--timeout=60000", ...flags], directory, bunEnv);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  // A crash prints only there, and the comparison below would hide it.
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  return { stdout, results, exitCode };
}

async function expectCompiledToRunAsPlain(files: Record<string, string>) {
  using dir = tempDir("accessors-above-objects-in-test-runs", files);
  const plain = await runTests(String(dir));
  expect(plain.results.filter(result => result.startsWith("fail"))).toEqual([]);
  expect(plain.results).not.toEqual([]);
  expect(await runTests(String(dir), "--aot")).toEqual(plain);
}

const app = {
  "app.ts": `
    export class Temp { c: number; constructor(c: number) { this.c = c; } get f() { return this.c * 2; } set f(v: number) { this.c = v / 2; } }
    export function Old(this: any, c: number) { this.c = c; }
    Object.defineProperty(Old.prototype, "f", { get: function (this: any) { return this.c * 2; }, set: function (this: any, v: number) { this.c = v / 2; }, configurable: true });
    export function sum(list: { f: number }[]): number { let total = 0; for (let i = 0; i < list.length; i++) total += list[i]!.f; return total; }
    export function fill(list: { f: number }[], value: number): void { for (let i = 0; i < list.length; i++) list[i]!.f = value; }`,
};

test("a spy on the getter and on the setter of a class", async () => {
  await expectCompiledToRunAsPlain({
    ...app,
    "one.test.ts": `
      import { spyOn, test } from "bun:test";
      import { Temp, fill, sum } from "./app";
      test("spied", () => {
        const list = [new Temp(1), new Temp(2)];
        console.log(sum(list));
        const getter = spyOn(Temp.prototype, "f", "get").mockReturnValue(100);
        console.log(sum(list), getter.mock.calls.length);
        getter.mockRestore();
        console.log(sum(list));
        const setter = spyOn(Temp.prototype, "f", "set").mockImplementation(function (this: Temp, v: number) { this.c = -v; });
        fill(list, 8);
        console.log(sum(list), setter.mock.calls.length);
        setter.mockRestore();
        fill(list, 8);
        console.log(sum(list));
      });`,
  });
});

test("a test lays another accessor on the prototype object of a constructor function, and gives the first back", async () => {
  await expectCompiledToRunAsPlain({
    ...app,
    "one.test.ts": `
      import { test } from "bun:test";
      import { Old, fill, sum } from "./app";
      test("replaced", () => {
        const list = [new (Old as any)(1), new (Old as any)(2)];
        console.log(sum(list));
        const before = Object.getOwnPropertyDescriptor(Old.prototype, "f")!;
        Object.defineProperty(Old.prototype, "f", { get() { return 100; }, set(this: any, v: number) { this.c = -v; }, configurable: true });
        console.log(sum(list));
        fill(list, 8);
        Object.defineProperty(Old.prototype, "f", before);
        console.log(sum(list));
        fill(list, 8);
        console.log(sum(list));
      });
      test("a second test finds it as the first left it", () => {
        const list = [new (Old as any)(3)];
        fill(list, 10);
        console.log(sum(list));
      });`,
  });
});
