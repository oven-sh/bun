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
const vitest = `import { test, vi } from "vitest";`;
const mockedRuntimeIsBehind = "errors > a mocked JSX runtime is imported behind the hoisted statements";
const namedBy = ["a string literal", "a const that holds the string"].map(
  by => `gets a hoisted mock that names its path with ${by}, and the real module is not evaluated`,
);
const notInstalled = "needs no real module once it is mocked";
const readThroughNamespace =
  "is called without a this and read through its namespace, so a later mock.module() reaches it";
const staysStatic = [`"./mod"`, `"./mod\u00e8le"`, `require.resolve("./mod")`, `byLet`, `fromHoisted`].map(
  path => `stays static while no hoisted call names its path: vi.mock(${path})`,
);

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
  ],
  "an error of the build has its number in front": [
    "errors > an import statement in a CommonJS file is still rejected",
  ],
  "the JSX runtime and an import with attributes are linked in front of a hoisted mock that names them": [
    ...[
      ` vi.mock("react/jsx-dev-runtime"`,
      `${vitest} vi.mock("react/jsx-dev-runtime"`,
      `import { test, vi } from "bun:test"; vi.mock("react/jsx-dev-runtime"`,
      `import { test, jest } from "bun:test"; jest.mock("react/jsx-dev-runtime"`,
      `${vitest} await vi.mock(import("react/jsx-dev-runtime")`,
      vitest + " vi.mock(`react/jsx-dev-runtime`",
      `${vitest} const runtime = "react/jsx-dev-runtime"; vi.mock(runtime`,
    ].map(call => `hoisting > ${call}, factory) reaches the JSX of the file`),
    `hoisting > with "jsx": "react-jsx", a mock of react/jsx-runtime`,
    "hoisting > a hand-written import of the JSX runtime gets the same mock as the file's JSX",
    ...[`[]`, `["--preload","./preload.jsx"]`].map(
      flags => `hoisting > a factory that wraps the real JSX runtime sees the JSX of the file: ${flags}`,
    ),
    "hoisting > a mocked JSX runtime loads behind the hoisted statements and ahead of the file's imports",
    "hoisting > JSX in a function that vi.hoisted() returns uses the mocked JSX runtime",
    "hoisting > a mock of a package reaches an import of it with attributes",
    "hoisting > a hoisted call names an import with attributes by a path that is not ASCII",
    "hoisting > an import with attributes that a hoisted call names keeps its loader",
    "hoisting > an eager import.meta.glob entry with a query follows a hoisted mock that names it",
    `${mockedRuntimeIsBehind}: JSX that vi.hoisted() evaluates`,
    `${mockedRuntimeIsBehind}: a factory that reads a later const`,
    ...["the JSX runtime", "createElement of the JSX package"].flatMap(kind =>
      [...namedBy, notInstalled].map(rule => `${kind} > ${rule}`),
    ),
    `an import with attributes > ${notInstalled}`,
  ],
  "the build does not see a mock of a module that is imported with attributes": [
    ...namedBy,
    readThroughNamespace,
    staysStatic[3],
  ].map(rule => `an import with attributes > ${rule}`),
  "the React Compiler leaves compiled code as it is": [
    "hoisting > a call that the React Compiler writes again that the file imports has no this",
    ...[...namedBy, notInstalled, readThroughNamespace, ...staysStatic].map(
      rule => `the runtime of the React Compiler > ${rule}`,
    ),
  ],
};

// How many cases of each section of the specification pass.
const sections = {
  "hoisting": 50,
  "the JSX runtime": 6,
  "createElement of the JSX package": 6,
  "the runtime of the React Compiler": 0,
  "an import with attributes": 4,
  "imports that stay static": 4,
  "not hoisted": 22,
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
    expect(Number(/^ *(\d+) filtered out$/m.exec(stderr)?.[1])).toBe(122 + 12 + 71 - passing - differing.length);
  },
);
