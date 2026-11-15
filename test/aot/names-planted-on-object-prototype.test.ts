import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// An executable locks Object.prototype, so compiled code takes a name that an object lacks for missing. A test run opens the names that its tests plant there.
// Each case plants a name and asks an object of compiled code for it in a way that goes on upward where the object lacks it.

async function runTests(directory: string, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--timeout=60000", ...flags], directory, bunEnv);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  // A crash prints only there, and the comparison below would hide it.
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  return { stdout, results, exitCode };
}

async function expectCompiledToRunAsPlain(files: Record<string, string>) {
  using dir = tempDir("names-planted-on-object-prototype", files);
  const plain = await runTests(String(dir));
  expect(plain.results.filter(result => result.startsWith("fail"))).toEqual([]);
  expect(plain.results).not.toEqual([]);
  expect(await runTests(String(dir), "--aot")).toEqual(plain);
}

test("a name that no layout lists is read off literals, off what a maker gives and off an instance", async () => {
  await expectCompiledToRunAsPlain({
    "one.test.ts": `
      import { test } from "bun:test";
      class Box { size = 1; }
      function make(size: number): any { return { size }; }
      function read(holder: any): unknown { let found: unknown; for (let turn = 0; turn < 3; turn++) found = holder.planted; return found; }
      test("read", () => {
        const kept = [make(1), new Box(), {}, { own: 1 }];
        console.log(kept.map(read), ({} as any).planted, ({ own: 1 } as any).planted, (new Box() as any).planted);
        (Object.prototype as any).planted = "here";
        console.log(kept.map(read), ({} as any).planted, ({ own: 1 } as any).planted, (new Box() as any).planted);
        delete (Object.prototype as any).planted;
        console.log(kept.map(read), ({} as any).planted, ({ own: 1 } as any).planted, (new Box() as any).planted);
      });`,
  });
});

test("a field that a literal leaves out is read in a loop", async () => {
  await expectCompiledToRunAsPlain({
    "one.test.ts": `
      import { test } from "bun:test";
      type Payload = { aborted?: boolean | string; count: number };
      function count(payloads: Payload[]): string { let seen = ""; for (let i = 0; i < payloads.length; i++) seen += String(payloads[i]!.aborted) + " "; return seen; }
      test("read", () => {
        const payloads: Payload[] = [{ count: 1 }, { aborted: true, count: 2 }, { count: 3 }];
        console.log(count(payloads));
        (Object.prototype as any).aborted = "planted";
        console.log(count(payloads));
        delete (Object.prototype as any).aborted;
        console.log(count(payloads));
      });
      test("a getter", () => {
        const payloads: Payload[] = [{ count: 1 }, { aborted: true, count: 2 }, { count: 3 }];
        Object.defineProperty(Object.prototype, "aborted", { get() { return "count " + this.count; }, configurable: true });
        console.log(count(payloads));
        delete (Object.prototype as any).aborted;
        console.log(count(payloads));
      });`,
  });
});

// The layout lists the field in the form that the definition creates, so compiled code creates it in line, where the run time's own watch on Object.prototype is not asked.
test("what a written descriptor leaves out is looked for above it", async () => {
  await expectCompiledToRunAsPlain({
    "one.test.ts": `
      import { test } from "bun:test";
      type Holder = { first: number; mark?: number };
      function define(holder: Holder, value: number) { Object.defineProperty(holder, "mark", { value, enumerable: true, writable: true, configurable: true }); }
      function defineLess(holder: object, value: number) { Object.defineProperty(holder, "mark", { value }); }
      test("a getter under get", () => {
        (Object.prototype as any).get = function () { return "planted"; };
        const holder: Holder = { first: 1 };
        let thrown = "none";
        try { Object.defineProperty(holder, "mark", { value: 7, enumerable: true, writable: true, configurable: true }); } catch (error) { thrown = (error as Error).name; }
        delete (Object.prototype as any).get;
        console.log(thrown, holder.mark, Object.keys(holder).join());
      });
      test("a setter under set, half way through a loop", () => {
        let thrown = 0;
        for (let turn = 0; turn < 50; turn++) {
          if (turn === 25) (Object.prototype as any).set = function () {};
          const holder: Holder = { first: 1 };
          try { define(holder, turn); } catch { thrown++; }
        }
        delete (Object.prototype as any).set;
        console.log(thrown);
      });
      test("the three flags", () => {
        const before = { first: 1 };
        defineLess(before, 1);
        (Object.prototype as any).enumerable = true;
        (Object.prototype as any).writable = true;
        (Object.prototype as any).configurable = true;
        const holder = { first: 1 };
        defineLess(holder, 2);
        delete (Object.prototype as any).enumerable;
        delete (Object.prototype as any).writable;
        delete (Object.prototype as any).configurable;
        console.log(JSON.stringify(Object.getOwnPropertyDescriptor(before, "mark")), JSON.stringify(Object.getOwnPropertyDescriptor(holder, "mark")));
      });`,
  });
});

test("Object.assign() into a literal meets what is planted under a name of the source", async () => {
  await expectCompiledToRunAsPlain({
    "one.test.ts": `
      import { test } from "bun:test";
      type Made = { base: number; mark?: number };
      function fill(mark: number): Made { return Object.assign<Made, { mark: number }>({ base: 1 }, { mark }); }
      test("a setter", () => {
        const taken: number[] = [];
        const before = fill(1);
        Object.defineProperty(Object.prototype, "mark", { set(v: number) { taken.push(v); }, get() { return -1; }, configurable: true });
        const made = fill(2);
        delete (Object.prototype as any).mark;
        console.log(Object.hasOwn(before, "mark"), Object.hasOwn(made, "mark"), taken.join());
      });
      test("a value that is read-only", () => {
        Object.defineProperty(Object.prototype, "mark", { value: 1, writable: false, configurable: true });
        let thrown = "none";
        try { fill(5); } catch (error) { thrown = (error as Error).name; }
        delete (Object.prototype as any).mark;
        console.log(thrown);
      });`,
  });
});
