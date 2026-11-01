// `bun test` runs top-level `vi.mock()`, `jest.mock()` and `vi.hoisted()` in front of the imports of their file. Its
// parser does that (src/js_parser/lower/hoist_test_mocks.rs), and `bun test --aot` does it to its own tree
// (src/aot/load/hoisted_mocks.rs). One specification holds for both: every case of
// test/js/bun/test/mock/mock-hoist.test.ts starts `bun test`, and here each starts it with --aot.
import { expect } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";
import { test } from "./supported";

const isolations = [`[]`, `["--isolate"]`, `["--isolate=modules"]`];
const laterConst = "factory can read a later const though an earlier file or a preload loaded the module";
const namespaceCall = "a call into another block of a TypeScript namespace keeps its this";

// A case that comes to agree turns this test red: take it out of its list.
const differs = {
  "a compiled module stays loaded for the next test file": ["jest", "vi"].flatMap(api =>
    isolations.map(flags => `errors > a ${api}.mock() ${laterConst}: ${flags}`),
  ),
  "the transpiler's cache holds no compiled code": isolations.map(
    flags => `modes > a file restored from the transpiler cache: ${flags}`,
  ),
  "the text of a function is what the file says": [
    "imports that stay static > export from, and an import that an export clause names",
    `not hoisted > ${namespaceCall}: a file that hoists`,
    `not hoisted > ${namespaceCall}: a file without any test API`,
  ],
  "an error of the build has its number in front": [
    "errors > an import statement in a CommonJS file is still rejected",
  ],
};

// How many cases of each section of the specification pass.
const sections = {
  "hoisting": 36,
  "imports that stay static": 4,
  "not hoisted": 19,
  "vi.mock(import(path))": 12,
  "modes": 7,
  "a top-level variable in a factory of jest.mock": 18,
  "a top-level variable in a factory of vi.mock": 18,
  "errors": 3,
  "source locations": 4,
};

test.each(Object.entries(sections))(
  "the specification of plain `bun test` holds compiled: %s",
  async (section, passing) => {
    await using run = Bun.spawn({
      cmd: [
        bunExe(),
        "test",
        "--timeout=120000",
        "-t",
        `^${section.replace(/[.()]/g, "\\$&")} `,
        "--preload",
        join(import.meta.dir, "harness/spawn-bun-test-compiled.ts"),
        join(import.meta.dir, "../js/bun/test/mock/mock-hoist.test.ts"),
      ],
      env: bunEnv,
      cwd: join(import.meta.dir, ".."),
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr] = await Promise.all([run.stderr.text(), run.exited]);
    const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[[\d.]+ms\])?$/gm)];
    const named = (result: string) => [...new Set(results.filter(it => it[1] === result).map(it => it[2]))].sort();
    const differing = Object.values(differs)
      .flat()
      .filter(name => name.startsWith(`${section} > `));
    expect(named("fail")).toEqual(differing.sort());
    expect(named("pass")).toHaveLength(passing);
    // A section that is not listed here would run in no case.
    expect(Number(/^ *(\d+) filtered out$/m.exec(stderr)?.[1])).toBe(121 + 13 - passing - differing.length);
  },
);
