import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// `new Set(list)` asks the new set for `add` and calls it for every value, and `new Map(list)` does so with `set`.
// No expression spells that lookup, so a test that replaces the method has to be seen where the list is written in place too.

async function runTests(directory: string, flags: string[] = [], layers = "TestRunLayers:0") {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: layers };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, env);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  return { stdout, results, exitCode };
}

// As one program and, where asked, with the code under test in a layer below the test file.
async function expectCompiledToRunAsPlain(files: Record<string, string>, layers: string[] = []) {
  using dir = tempDir("written-list-of-a-collection", files);
  const [plain, ...compiled] = await Promise.all([
    runTests(String(dir)),
    runTests(String(dir), ["--aot"]),
    ...layers.map(words => runTests(String(dir), ["--aot"], words)),
  ]);
  expect(plain.results.filter(result => result.startsWith("fail"))).toEqual([]);
  expect(plain.results).not.toEqual([]);
  for (const result of compiled) expect(result).toEqual(plain);
}

// Code under test in a file of its own, and every way to write the list in place.
const uses = `
  const k = String(process.argv.length);
  class Holder { ids = new Set(["field" + k]); table = new Map([["field" + k, 1]]); }
  function byDefault(ids = new Set(["default" + k]), table = new Map([["default" + k, 1]])) { return [ids, table]; }
  export const sets = {
    two: () => new Set(["x" + k, "y" + k]),
    same: () => new Set([k, k]),
    asConst: () => new Set(["x" + k] as const),
    typed: () => new Set<string>(["x" + k]),
    copied: () => Array.from(new Set(["x" + k, "y" + k])),
    spread: () => [...new Set(["x" + k, "y" + k])],
    field: () => new Holder().ids,
    byDefault: () => byDefault()[0],
    held: () => { const list = ["x" + k, "y" + k]; return new Set(list); },
    constants: () => new Set(["x", "y"]),
    empty: () => new Set([]),
  };
  export const maps = {
    one: () => new Map([["x" + k, 1]]),
    two: () => new Map([["x" + k, 1], ["y" + k, 2]]),
    same: () => new Map([[k, 1], [k, 2]]),
    long: () => new Map([["x" + k, 1, "unread" + k]] as any),
    asConst: () => new Map([["x" + k, 1]] as const),
    typed: () => new Map<string, number>([["x" + k, 1]]),
    copied: () => Array.from(new Map([["x" + k, 1]])),
    field: () => new Holder().table,
    byDefault: () => byDefault()[1],
    held: () => { const list: [string, number][] = [["x" + k, 1]]; return new Map(list); },
    constants: () => new Map([["x", 1]]),
    empty: () => new Map([]),
  };
  export function show(made: any) { return JSON.stringify([...made]); }`;

const cases = [
  ["Set", "add", "sets"],
  ["Map", "set", "maps"],
];

test.each(cases)("a spy on %s.prototype.%s", async (holder, name, makers) => {
  await expectCompiledToRunAsPlain(
    {
      "uses.ts": uses,
      "one.test.ts": `
      import { expect, spyOn, test } from "bun:test";
      import { ${makers} as makers, show } from "./uses";
      test("counted", () => {
        for (const [way, make] of Object.entries(makers)) {
          const spy = spyOn(${holder}.prototype, "${name}");
          const made = make();
          console.log(way, spy.mock.calls.length, JSON.stringify(spy.mock.calls), show(made));
          spy.mockRestore();
          console.log(way, spy.mock.calls.length, show(make()));
        }
      });
      test("in the test file", () => {
        const spy = spyOn(${holder}.prototype, "${name}");
        const made = new ${holder}([${holder === "Set" ? "String(process.argv.length)" : "[String(process.argv.length), 1]"}]);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(made.size).toBe(1);
        spy.mockRestore();
      });
      test("what the spy does instead is all that is done", () => {
        const spy = spyOn(${holder}.prototype, "${name}").mockImplementation(function (this: any) { return this; });
        for (const [way, make] of Object.entries(makers)) console.log(way, show(make()));
        console.log(spy.mock.calls.length);
        spy.mockRestore();
      });`,
    },
    ["TestRunLayers:1,TestRunPartFiles:1", "TestRunLayers:2,TestRunPartFiles:1"],
  );
});

test.each(cases)("%s.prototype.%s is assigned, defined and deleted", async (holder, name, makers) => {
  await expectCompiledToRunAsPlain({
    "uses.ts": uses,
    "one.test.ts": `
      import { test } from "bun:test";
      import { ${makers} as makers, show } from "./uses";
      const real: any = ${holder}.prototype.${name};
      let calls = 0;
      function counting(this: any, ...given: unknown[]) { calls++; return Reflect.apply(real, this, given); }
      function all(label: string) {
        for (const [way, make] of Object.entries(makers)) {
          calls = 0;
          let shown;
          try { shown = show(make()); } catch (error) { shown = (error as Error).constructor.name; }
          console.log(label, way, calls, shown);
        }
      }
      test("assigned", () => {
        all("before");
        (${holder}.prototype as any).${name} = counting;
        all("assigned");
        ${holder}.prototype.${name} = real;
        all("after");
      });
      test("defined", () => {
        Object.defineProperty(${holder}.prototype, "${name}", { value: counting, writable: true, configurable: true });
        all("defined");
        Object.defineProperty(${holder}.prototype, "${name}", { value: real, writable: true, configurable: true });
        all("after");
      });
      test("read once for a whole list", () => {
        let reads = 0;
        Object.defineProperty(${holder}.prototype, "${name}", { get() { reads++; return counting; }, configurable: true });
        try {
          for (const [way, make] of Object.entries(makers)) { reads = 0; make(); console.log(way, reads); }
        } finally {
          Object.defineProperty(${holder}.prototype, "${name}", { value: real, writable: true, configurable: true });
        }
      });
      test("deleted", () => {
        delete (${holder}.prototype as any).${name};
        try { all("deleted"); } finally { ${holder}.prototype.${name} = real; }
        all("after");
      });`,
  });
});

test("a test that replaces neither leaves both as they are", async () => {
  await expectCompiledToRunAsPlain({
    "uses.ts": uses,
    "one.test.ts": `
      import { test } from "bun:test";
      import { maps, sets, show } from "./uses";
      test("made", () => {
        for (const [way, make] of Object.entries({ ...sets, ...maps })) console.log(way, show(make()));
      });`,
  });
});
