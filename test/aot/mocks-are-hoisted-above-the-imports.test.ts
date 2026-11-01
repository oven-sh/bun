// `bun test` runs top-level `vi.mock()`, `jest.mock()` and `vi.hoisted()` in front of the imports of their file. Its
// parser does that (src/js_parser/lower/hoist_test_mocks.rs), and `bun test --aot` does it to its own tree
// (src/aot/load/hoisted_mocks.rs). One specification holds for both: every case of
// test/js/bun/test/mock/mock-hoist.test.ts starts `bun test`, and here each starts it with --aot.
import { expect } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { test } from "./supported";

raiseDefaultTimeout(600_000);

const isolations = [`[]`, `["--isolate"]`, `["--isolate=modules"]`];
const laterConst = "factory can read a later const though an earlier file or a preload loaded the module";
const namespaceCall = "a call into another block of a TypeScript namespace keeps its this";

// A case that comes to agree turns this test red: take it out of its list.
const differs = {
  "a compiled module stays loaded for the next test file": ["jest", "vi"].flatMap(api =>
    isolations.map(flags => `errors > a ${api}.mock() ${laterConst}: ${flags}`),
  ),
  "a default import of what jest.mock() replaced": ["./mod", "node:os", "pkg"].map(
    path => `hoisting > as in Jest, a default import of ${path} gets the object that a jest.mock() factory returns`,
  ),
  "the order of the keys of a mocked module": ["hoisting > every shape of import reads the mock"],
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

test("the specification of plain `bun test` holds compiled", async () => {
  await using run = Bun.spawn({
    cmd: [
      bunExe(),
      "test",
      "--timeout=120000",
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
  expect(named("fail")).toEqual(Object.values(differs).flat().sort());
  expect(named("pass")).toHaveLength(117);
});
