// The tests that people write with mocks every day, as a whole cross: how the mock is laid, times where, times what stands between the tests, times how the mocked file is taken, times one test or two.
// Each case is a project of its own: a file `kettle` that is mocked, a file `kitchen` that uses it, and one test file. After each test the project notes five things, and prints them at the end in one line:
// what the user of the file says, what the file says, its other export, how often the mock was called, and how often the body of the real file has run.

const laid = {
  "bare": (path: string) => `jest.mock(${path});`,
  "a-factory": (path: string) => `jest.mock(${path}, () => ({ boil: jest.fn(() => "mock"), brand: "mock brand" }));`,
  "the-original-in-the-factory": (path: string) =>
    `jest.mock(${path}, () => ({ ...jest.requireActual(${path}), boil: jest.fn(() => "mock") }));`,
  "the-original-awaited-in-the-factory": (path: string) =>
    `vi.mock(${path}, async importOriginal => ({ ...(await importOriginal()), boil: vi.fn(() => "mock") }));`,
  "mock-module": (path: string) => `mock.module(${path}, () => ({ boil: mock(() => "mock"), brand: "mock brand" }));`,
  "a-spy": (_path: string, kettle: string) => `spyOn(${kettle}, "boil").mockReturnValue("mock");`,
};

const places = ["at-the-top", "before-each-test", "in-the-test"] as const;

const between = {
  "nothing": "",
  "reset-modules": "jest.resetModules();",
  "clear-all-mocks": "jest.clearAllMocks();",
  "restore-all-mocks": "jest.restoreAllMocks();",
  "reset-all-mocks": "jest.resetAllMocks();",
};

// The kind of the two files, what the test file imports, how a test comes by the two, and the mocked file alone.
const taken = {
  "imported-at-run-time": {
    kind: "mjs",
    imports: "",
    both: '{ serve: (await import("./kitchen.mjs")).serve, kettle: await import("./kettle.mjs") }',
    kettle: 'await import("./kettle.mjs")',
  },
  "required": {
    kind: "cjs",
    imports: "",
    both: '{ serve: require("./kitchen.cjs").serve, kettle: require("./kettle.cjs") }',
    kettle: 'require("./kettle.cjs")',
  },
  "imported": {
    kind: "mjs",
    imports: 'import * as kettle from "./kettle.mjs";\nimport { serve } from "./kitchen.mjs";',
    both: "{ serve, kettle }",
    kettle: "kettle",
  },
};

const tests = { "one-test": ["first"], "two-tests": ["first", "second"] };

const sources = {
  mjs: {
    "kettle.mjs":
      'globalThis.boiled = (globalThis.boiled ?? 0) + 1;\nexport const boil = () => "real";\nexport const brand = "real brand";\n',
    "kitchen.mjs": 'import { boil, brand } from "./kettle.mjs";\nexport const serve = () => boil() + "/" + brand;\n',
  },
  cjs: {
    "kettle.cjs":
      'globalThis.boiled = (globalThis.boiled ?? 0) + 1;\nexports.boil = () => "real";\nexports.brand = "real brand";\n',
    "kitchen.cjs":
      'const kettle = require("./kettle.cjs");\nexports.serve = () => kettle.boil() + "/" + kettle.brand;\n',
  },
};

export type EverydayMockCase = { name: string; files: Record<string, string> };

export function everydayMockCases(): EverydayMockCase[] {
  const cases: EverydayMockCase[] = [];
  for (const [way, lay] of Object.entries(laid))
    for (const place of places)
      for (const [swept, sweep] of Object.entries(between))
        for (const [came, { kind, imports, both, kettle }] of Object.entries(taken))
          for (const [many, names] of Object.entries(tests)) {
            const lays = lay(JSON.stringify(`./kettle.${kind}`), kettle);
            const name = `${way}--${place}--${swept}--${came}--${many}`;
            const text = [
              'import { afterAll, afterEach, beforeEach, jest, mock, spyOn, test, vi } from "bun:test";',
              imports,
              "const lines = [];",
              'const told = async ask => {\n  try {\n    return String(await ask());\n  } catch (error) {\n    return "threw " + error.name;\n  }\n};',
              "const look = async step => {",
              "  let held;",
              `  try {\n    held = ${both};\n  } catch (error) {\n    lines.push(step + " the load threw " + error.name);\n    return;\n  }`,
              "  lines.push(",
              "    [",
              "      step,",
              "      await told(() => held.serve()),",
              "      await told(() => held.kettle.boil()),",
              "      await told(() => held.kettle.brand),",
              '      await told(() => held.kettle.boil.mock?.calls.length ?? "-"),',
              "      globalThis.boiled ?? 0,",
              "    ].join(),",
              "  );",
              "};",
              place === "at-the-top" && lays,
              place === "before-each-test" && `beforeEach(async () => {\n  ${lays}\n});`,
              sweep && `afterEach(() => {\n  ${sweep}\n});`,
              ...names.map(
                (each, at) =>
                  `test(${JSON.stringify(each)}, async () => {\n${place === "in-the-test" ? `  ${lays}\n` : ""}  await look("${at + 1}");\n});`,
              ),
              // A branch that is never taken: a compiler that folds it the wrong way changes the line.
              'afterAll(() => {\n  let text = lines.join(" . ") || "nothing";\n  if (process.argv.length > 99) text = "a long command line";\n  console.log("SAID " + text);\n});',
            ]
              .filter(Boolean)
              .join("\n");
            cases.push({
              name,
              files: {
                "package.json": JSON.stringify({ name: `@made-up/${name}`, private: true, type: "module" }) + "\n",
                "everyday.test.js": text + "\n",
                ...sources[kind as "mjs" | "cjs"],
              },
            });
          }
  return cases;
}
