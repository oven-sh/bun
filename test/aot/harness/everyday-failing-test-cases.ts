// Everyday test files in pairs, beside everyday-mock-cases.ts: a good one, which passes, and a bad one, which parts from it in one spot and fails. Each case is a project of its own.
//
// The spot: a wrong expected value, a count of assertions that is one off, a rejection that nobody awaits, a throw in a hook, a timer or a mock, `done` that is never called, a factory of a mock that throws or
// rejects. Beside it stands what such a file also does: a module mock, a spy, fake timers, a preload. A second test stands behind the first, and has to be run and told of all the same.
import type { EverydayMockCase } from "./everyday-mock-cases";

const lines = (...all: (string | false | string[])[]) => all.flat().filter(line => line !== false && line !== "").join("\n") + "\n"; // prettier-ignore

// What stands at the top of the file, and what the test begins with. In each of them `weigh(1, 2)` is 3.
const besides: Record<string, { top: string[]; begins: string[]; files?: Record<string, string> }> = {
  "nothing": { top: ['import { weigh } from "./scale.mjs";'], begins: [] },
  "mock-module": {
    top: ['mock.module("./scale.mjs", () => ({ weigh: () => 3 }));'],
    begins: ['const { weigh } = await import("./scale.mjs");'],
  },
  "vi-do-mock": {
    top: [],
    begins: ['vi.doMock("./scale.mjs", () => ({ weigh: () => 3 }));', 'const { weigh } = await import("./scale.mjs");'],
  },
  "a-spy": {
    top: ['import * as scale from "./scale.mjs";', "const kit = { weigh: scale.weigh };"],
    begins: [
      'const watched = spyOn(kit, "weigh");',
      "const weigh = (a, b) => kit.weigh(a, b);",
      "watched.mockClear();",
    ],
  },
  "fake-timers": {
    top: ['import { weigh } from "./scale.mjs";'],
    begins: [
      "jest.useFakeTimers();",
      "let rang = 0;",
      "setTimeout(() => rang++, 1000);",
      "jest.advanceTimersByTime(1000);",
      "jest.useRealTimers();",
      'if (rang !== 1) throw new Error("the fake timer did not ring");',
    ],
  },
  "a-preload": {
    top: ['import { weigh } from "./scale.mjs";'],
    begins: ['if (!globalThis.beganBy) throw new Error("the preload did not run");'],
    files: {
      "bunfig.toml": '[test]\npreload = ["./first.mjs"]\n',
      "first.mjs":
        'import { beforeEach } from "bun:test";\nbeforeEach(() => {\n  globalThis.beganBy = "the preload";\n});\n',
    },
  },
};

type Spot = {
  /** What stands in front of the tests: the good one, the bad one. */
  top?: [string, string];
  /** The body of the first test behind what it begins with. */
  body?: [string[], string[]];
  /** The whole first test, where it is not `test("the first", async () => { .. })`. BEGINS is what it begins with. */
  whole?: [string[], string[]];
  files?: Record<string, string>;
};

const asked = [
  "const asked = load => {",
  "  try {",
  "    return String(load().seen);",
  "  } catch {",
  '    return "threw";',
  "  }",
  "};",
];

const spots: Record<string, Spot> = {
  "a-wrong-value": { body: [["expect(weigh(1, 2)).toBe(3);"], ["expect(weigh(1, 2)).toBe(4);"]] },
  "a-wrong-record": {
    body: [
      ["expect({ sum: weigh(1, 2) }).toEqual({ sum: 3 });"],
      ["expect({ sum: weigh(1, 2) }).toEqual({ sum: 4 });"],
    ],
  },
  "the-count-of-assertions": {
    body: [
      ["expect.assertions(1);", "expect(weigh(1, 2)).toBe(3);"],
      ["expect.assertions(2);", "expect(weigh(1, 2)).toBe(3);"],
    ],
  },
  "no-assertion-where-one-is-asked-for": {
    body: [
      ["expect.hasAssertions();", "expect(weigh(1, 2)).toBe(3);"],
      ["expect.hasAssertions();", "weigh(1, 2);"],
    ],
  },
  "a-throw": { body: [["weigh(1, 2);"], ["weigh(1, 2);", 'throw new Error("thrown");']] },
  "a-throw-behind-an-await": { body: [["await rest(5);"], ["await rest(5);", 'throw new Error("behind an await");']] },
  "a-rejection-that-is-handed-back": {
    body: [["return Promise.resolve(weigh(1, 2));"], ['return Promise.reject(new Error("handed back"));']],
  },
  "a-rejection-nobody-awaits": {
    body: [
      ["void Promise.resolve(weigh(1, 2));", "await rest(20);"],
      ['void Promise.reject(new Error("nobody awaits it"));', "await rest(20);"],
    ],
  },
  "a-throw-in-a-timer": {
    body: [
      ["setTimeout(() => weigh(1, 2), 5);", "await rest(30);"],
      ["setTimeout(() => {", '  throw new Error("in a timer");', "}, 5);", "await rest(30);"],
    ],
  },
  "a-throw-in-a-microtask": {
    body: [
      ["queueMicrotask(() => weigh(1, 2));", "await rest(10);"],
      ["queueMicrotask(() => {", '  throw new Error("in a microtask");', "});", "await rest(10);"],
    ],
  },
  "a-throw-before-each": {
    top: ["beforeEach(() => {});", 'beforeEach(() => {\n  throw new Error("before each");\n});'],
    body: [["weigh(1, 2);"], ["weigh(1, 2);"]],
  },
  "a-throw-after-each": {
    top: ["afterEach(() => {});", 'afterEach(() => {\n  throw new Error("after each");\n});'],
    body: [["weigh(1, 2);"], ["weigh(1, 2);"]],
  },
  "a-throw-before-all": {
    top: ["beforeAll(() => {});", 'beforeAll(() => {\n  throw new Error("before all");\n});'],
    body: [["weigh(1, 2);"], ["weigh(1, 2);"]],
  },
  "a-throw-after-all": {
    top: ["afterAll(() => {});", 'afterAll(() => {\n  throw new Error("after all");\n});'],
    body: [["weigh(1, 2);"], ["weigh(1, 2);"]],
  },
  "a-rejection-before-each": {
    top: [
      "beforeEach(async () => {\n  await rest(2);\n});",
      'beforeEach(async () => {\n  await rest(2);\n  throw new Error("before each, late");\n});',
    ],
    body: [["weigh(1, 2);"], ["weigh(1, 2);"]],
  },
  "a-throw-in-a-mock": {
    body: [
      ["const told = jest.fn(() => weigh(1, 2));", "expect(told()).toBe(3);"],
      ["const told = jest.fn(() => {", '  throw new Error("in the mock");', "});", "expect(told()).toBe(3);"],
    ],
  },
  "how-often-a-mock-was-called": {
    body: [
      ["const told = jest.fn(() => weigh(1, 2));", "told();", "expect(told).toHaveBeenCalledTimes(1);"],
      ["const told = jest.fn(() => weigh(1, 2));", "told();", "expect(told).toHaveBeenCalledTimes(2);"],
    ],
  },
  "what-a-mock-was-called-with": {
    body: [
      ["const told = jest.fn();", "told(weigh(1, 2));", "expect(told).toHaveBeenCalledWith(3);"],
      ["const told = jest.fn();", "told(weigh(1, 2));", "expect(told).toHaveBeenCalledWith(4);"],
    ],
  },
  "rejects-over-one-that-resolves": {
    body: [
      ['await expect(Promise.reject(new Error("no"))).rejects.toThrow("no");'],
      ['await expect(Promise.resolve(weigh(1, 2))).rejects.toThrow("no");'],
    ],
  },
  "resolves-over-one-that-rejects": {
    body: [
      ["await expect(Promise.resolve(weigh(1, 2))).resolves.toBe(3);"],
      ['await expect(Promise.reject(new Error("no"))).resolves.toBe(3);'],
    ],
  },
  "to-throw-over-one-that-does-not": {
    body: [
      ["expect(() => {", '  throw new Error("no");', '}).toThrow("no");'],
      ['expect(() => weigh(1, 2)).toThrow("no");'],
    ],
  },
  "an-inline-snapshot": {
    body: [["expect(weigh(1, 2)).toMatchInlineSnapshot(`3`);"], ["expect(weigh(1, 2)).toMatchInlineSnapshot(`4`);"]],
  },
  "done-is-never-called": {
    whole: [
      ['test("the first", done => {', "  setTimeout(done, 5);", "}, 300);"],
      ['test("the first", done => {', "  setTimeout(() => {}, 5);", "}, 300);"],
    ],
  },
  "done-is-called-with-an-error": {
    whole: [
      ['test("the first", done => {', "  setTimeout(() => done(), 5);", "}, 2000);"],
      ['test("the first", done => {', '  setTimeout(() => done(new Error("told to done")), 5);', "}, 2000);"],
    ],
  },
  "a-test-that-does-not-end-in-time": {
    whole: [
      ['test("the first", async () => {', "  await rest(5);", "}, 300);"],
      ['test("the first", async () => {', "  await new Promise(() => {});", "}, 300);"],
    ],
  },
  "a-test-that-is-said-to-fail": {
    whole: [
      ['test.failing("the first", () => {', '  throw new Error("as foretold");', "});"],
      ['test.failing("the first", () => {});'],
    ],
  },
  "a-factory-that-throws-and-is-awaited": {
    files: { "crate.mjs": "export const lid = 0;\n" },
    body: [
      ['mock.module("./crate.mjs", () => ({ lid: 1 }));', 'expect((await import("./crate.mjs")).lid).toBe(1);'],
      [
        'mock.module("./crate.mjs", () => {',
        '  throw new Error("the factory throws");',
        "});",
        'expect((await import("./crate.mjs")).lid).toBe(1);',
      ],
    ],
  },
  "a-factory-that-rejects-and-is-awaited": {
    files: { "crate.mjs": "export const lid = 0;\n" },
    body: [
      ['vi.doMock("./crate.mjs", async () => ({ lid: 1 }));', 'expect((await import("./crate.mjs")).lid).toBe(1);'],
      [
        'vi.doMock("./crate.mjs", async () => {',
        "  await rest(2);",
        '  throw new Error("the factory rejects");',
        "});",
        'expect((await import("./crate.mjs")).lid).toBe(1);',
      ],
    ],
  },
  "a-factory-that-throws-and-nobody-awaits": {
    files: { "crate.mjs": "export const lid = 0;\n" },
    body: [
      ['mock.module("./crate.mjs", () => ({ lid: 1 }));', 'void import("./crate.mjs");', "await rest(30);"],
      [
        'mock.module("./crate.mjs", () => {',
        '  throw new Error("the factory throws");',
        "});",
        'void import("./crate.mjs");',
        "await rest(30);",
      ],
    ],
  },
  "a-factory-that-rejects-and-nobody-awaits": {
    files: { "crate.mjs": "export const lid = 0;\n" },
    body: [
      ['vi.doMock("./crate.mjs", async () => ({ lid: 1 }));', 'void import("./crate.mjs");', "await rest(30);"],
      [
        'vi.doMock("./crate.mjs", async () => {',
        "  await rest(2);",
        '  throw new Error("the factory rejects");',
        "});",
        'void import("./crate.mjs");',
        "await rest(30);",
      ],
    ],
  },
  "a-second-factory-that-rejects-behind-one-that-never-settles": {
    files: {
      "reel.mjs": 'export const width = "real";\n',
      "line.mjs": 'import { width } from "./reel.mjs";\nexport const seen = width;\n',
      "rod.mjs": 'import { seen as below } from "./line.mjs";\nexport const seen = "rod " + below;\n',
    },
    top: [asked.join("\n"), asked.join("\n")],
    body: [
      [
        'vi.doMock("./reel.mjs", async () => {',
        "  await new Promise(() => {});",
        "});",
        'asked(() => require("./line.mjs"));',
        'vi.doMock("./reel.mjs", async () => {',
        "  await rest(10);",
        '  return { width: "late" };',
        "});",
        'asked(() => require("./rod.mjs"));',
        "await rest(40);",
      ],
      [
        'vi.doMock("./reel.mjs", async () => {',
        "  await new Promise(() => {});",
        "});",
        'asked(() => require("./line.mjs"));',
        'vi.doMock("./reel.mjs", async () => {',
        "  await rest(10);",
        '  throw new Error("late");',
        "});",
        'asked(() => require("./rod.mjs"));',
        "await rest(40);",
      ],
    ],
  },
};

export function everydayFailingTests(): (EverydayMockCase & { fails: boolean })[] {
  const cases: (EverydayMockCase & { fails: boolean })[] = [];
  for (const [spot, { top, body, whole, files }] of Object.entries(spots))
    for (const [beside, { top: besideTop, begins, files: besideFiles }] of Object.entries(besides))
      for (const [twin, at] of [
        ["good", 0],
        ["bad", 1],
      ] as const) {
        const name = `${spot}--beside-${beside}--${twin}`;
        cases.push({
          name,
          fails: twin === "bad",
          files: {
            "package.json": JSON.stringify({ name: `@made-up/${name}`, private: true, type: "module" }) + "\n",
            "scale.mjs": "export const weigh = (a, b) => a + b;\n",
            ...files,
            ...besideFiles,
            "everyday.test.js": lines(
              'import { afterAll, afterEach, beforeAll, beforeEach, expect, jest, mock, spyOn, test, vi } from "bun:test";',
              besideTop,
              "const rest = time => new Promise(done => setTimeout(done, time));",
              'console.log("SAID the file runs");',
              top?.[at] ?? "",
              // Where the first test is written whole, what stands beside it is done in a test in front.
              whole
                ? [
                    'test("in front", async () => {',
                    begins.map(line => "  " + line),
                    "  expect(weigh(1, 2)).toBe(3);",
                    "});",
                    whole[at],
                  ].flat()
                : [
                    'test("the first", async () => {',
                    begins.map(line => "  " + line),
                    body![at].map(line => "  " + line),
                    "});",
                  ].flat(),
              'test("the one behind it", () => {',
              "  expect(1).toBe(1);",
              "});",
            ),
          },
        });
      }
  return cases;
}
