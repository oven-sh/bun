// Two more crosses of the tests that people write with mocks every day, beside everyday-mock-cases.ts. Each case is a project of its own.
//
// What stays from one test file to the next: three test files in one run. The first mocks a `lamp`, the second mocks nothing, the third mocks it with another word; or the first only loads, and the second is
// the first to mock. A `room` uses the lamp and is loaded at the
// top of each test file; a `hall` does the same and is loaded inside the test. Each test file prints what the two say, and how often the files that use the lamp have run so far.
//
// A mock that is laid twice: one test lays a mock over the lamp, loads the room, and then resets the modules or not, lays the mock again, ends it or does nothing, and loads the room again. The body of the
// lamp prints when it runs, so a lamp that was mocked in order not to run shows if it does.
import type { EverydayMockCase } from "./everyday-mock-cases";

const lampPackage = "@made-up/lamp";
const inPackage = (type: string, text: string) => ({
  [`node_modules/${lampPackage}/package.json`]: JSON.stringify({ name: lampPackage, version: "1.0.0", ...(type && { type }), main: "index.js" }) + "\n", // prettier-ignore
  [`node_modules/${lampPackage}/index.js`]: text,
});

// What is mocked: how it is named, the export that is asked for, and its files.
const lamps: Record<string, { named: string; key: string; files: Record<string, string> }> = {
  "a-commonjs-file": { named: "./lamp.cjs", key: "glow", files: { "lamp.cjs": 'exports.glow = () => "real";\n' } },
  "an-es-module": { named: "./lamp.mjs", key: "glow", files: { "lamp.mjs": 'export const glow = () => "real";\n' } },
  "a-commonjs-package": { named: lampPackage, key: "glow", files: inPackage("", 'exports.glow = () => "real";\n') },
  "an-es-package": {
    named: lampPackage,
    key: "glow",
    files: inPackage("module", 'export const glow = () => "real";\n'),
  },
  "a-json-file": { named: "./lamp.json", key: "glow", files: { "lamp.json": '{ "glow": "real" }\n' } },
  "a-built-in-module": { named: "node:os", key: "type", files: {} },
};

const counts = "globalThis.ran = (globalThis.ran ?? 0) + 1;\n";
const shown = 'const shown = value => (typeof value === "function" ? value() : value);\n';

// How a file holds the lamp: its kind, its text, and the text of a file between the two where there is one. LAMP is how the lamp is named, KEY the export, DOOR the file between.
const holds: Record<string, [kind: string, text: string, between?: string]> = {
  "takes-the-name-out-at-its-top": ["cjs", 'const { KEY } = require("LAMP");\nexports.look = () => shown(KEY);\n'],
  "keeps-the-whole": ["cjs", 'const lamp = require("LAMP");\nexports.look = () => shown(lamp.KEY);\n'],
  "asks-each-time": ["cjs", 'exports.look = () => shown(require("LAMP").KEY);\n'],
  "spreads-it-into-its-exports": [
    "cjs",
    'module.exports = {\n  ...require("LAMP"),\n  look() {\n    return shown(this.KEY);\n  },\n};\n',
  ],
  "through-a-file-between": [
    "cjs",
    'const door = require("DOOR");\nexports.look = () => door.look();\n',
    'const { KEY } = require("LAMP");\nexports.look = () => shown(KEY);\n',
  ],
  "an-es-file-over-a-commonjs-file": [
    "mjs",
    'import door from "DOOR";\nexport const look = () => door.look();\n',
    'const { KEY } = require("LAMP");\nexports.look = () => shown(KEY);\n',
  ],
  "an-es-file-imports-the-name": ["mjs", 'import { KEY } from "LAMP";\nexport const look = () => shown(KEY);\n'],
  "an-es-file-reckons-at-its-top": [
    "mjs",
    'import { KEY } from "LAMP";\nconst found = shown(KEY);\nexport const look = () => found;\n',
  ],
  "a-commonjs-file-reckons-at-its-top": [
    "cjs",
    'const found = shown(require("LAMP").KEY);\nexports.look = () => found;\n',
  ],
};

const told =
  'const told = async ask => {\n  try {\n    return String(await ask());\n  } catch (error) {\n    return "threw " + error.name;\n  }\n};';

export function mocksFromOneTestFileToTheNext(): EverydayMockCase[] {
  const cases: EverydayMockCase[] = [];
  for (const [lamp, { named, key, files }] of Object.entries(lamps))
    for (const [held, [kind, text, between]] of Object.entries(holds))
      for (const way of ["a-factory", "bare", "mock-module"])
        for (const place of ["at-the-top", "in-the-test", "first-in-the-second-test-file"]) {
          const isValue = lamp === "a-json-file";
          const made = (word: string) => (isValue ? JSON.stringify(word) : `jest.fn(() => ${JSON.stringify(word)})`);
          const factory = (word: string) =>
            `() => ({ __esModule: true, ${key}: ${made(word)}, default: { ${key}: ${made(word)} } })`;
          const lays = (word: string) =>
            way === "bare"
              ? `jest.mock(${JSON.stringify(named)});`
              : `${way === "a-factory" ? "jest.mock" : "mock.module"}(${JSON.stringify(named)}, ${factory(word)});`;
          const user = (door: string) =>
            (text.startsWith("import") ? text.replace(/\n/, "\n" + counts + shown) : counts + shown + text)
              .replaceAll("LAMP", named)
              .replaceAll("KEY", key)
              .replaceAll("DOOR", door);
          const testFile = (name: string, atTheTop: string, inTheTest: string) =>
            [
              'import { afterAll, jest, mock, test } from "bun:test";',
              kind === "cjs" ? 'const room = require("./room.cjs");' : 'import * as room from "./room.mjs";',
              "const lines = [];",
              told,
              atTheTop,
              `test(${JSON.stringify(name)}, async () => {`,
              inTheTest && `  ${inTheTest}`,
              "  lines.push(await told(() => room.look()));",
              `  lines.push(await told(${kind === "cjs" ? '() => require("./hall.cjs").look()' : 'async () => (await import("./hall.mjs")).look()'}));`,
              "});",
              // A branch that is never taken: a compiler that folds it the wrong way changes the line.
              `afterAll(() => {\n  let text = lines.join() + " ran " + (globalThis.ran ?? 0);\n  if (process.argv.length > 99) text = "a long command line";\n  console.log("SAID ${name} " + text);\n});`,
            ]
              .filter(Boolean)
              .join("\n") + "\n";
          const name = `${lamp}--${held}--${way}--${place}`;
          cases.push({
            name,
            files: {
              "package.json": JSON.stringify({ name: `@made-up/${name}`, private: true, type: "module" }) + "\n",
              ...files,
              [`room.${kind}`]: user("./door-of-the-room.cjs"),
              [`hall.${kind}`]: user("./door-of-the-hall.cjs"),
              ...(between && {
                "door-of-the-room.cjs": (counts + shown + between).replaceAll("LAMP", named).replaceAll("KEY", key),
                "door-of-the-hall.cjs": (counts + shown + between).replaceAll("LAMP", named).replaceAll("KEY", key),
              }),
              "1-first.test.mjs": testFile(
                "first",
                place === "at-the-top" ? lays("mock") : "",
                place === "in-the-test" ? lays("mock") : "",
              ),
              "2-second.test.mjs": testFile(
                "second",
                "",
                place === "first-in-the-second-test-file" ? lays("mock") : "",
              ),
              "3-third.test.mjs": testFile("third", lays("other"), ""),
            },
          });
        }
  return cases;
}

export function mocksLaidTwice(): EverydayMockCase[] {
  const cases: EverydayMockCase[] = [];
  for (const [way, call] of Object.entries({
    "vi-do-mock": "vi.doMock",
    "jest-do-mock": "jest.doMock",
    "mock-module": "mock.module",
  }))
    for (const [factory, made] of Object.entries({
      "a-factory": '{ glow: "mock" + laid, shade: () => "mocked" }',
      "the-original-in-the-factory": '{ ...jest.requireActual("./lamp.KIND"), glow: "mock" + laid }',
    }))
      for (const [swept, sweep] of Object.entries({ "reset-modules": "jest.resetModules();", "nothing-between": "" }))
        for (const [then, next] of Object.entries({
          "laid-again": "lay();",
          "ended": 'jest.doUnmock("./lamp.KIND");',
          "left-as-it-is": "",
        }))
          for (const [came, kind] of Object.entries({ "imported-at-run-time": "mjs", "required": "cjs" })) {
            const room = kind === "mjs" ? '(await import("./room.mjs"))' : 'require("./room.cjs")';
            const name = `${way}--${factory}--${swept}--${then}--${came}`;
            const text = [
              'import { jest, mock, test, vi } from "bun:test";',
              "let laid = 0;",
              `const lay = () => {\n  laid++;\n  ${call}("./lamp.KIND", () => (${made}));\n  let text = "laid " + laid;\n  if (process.argv.length > 99) text = "a long command line";\n  console.log("SAID " + text);\n};`,
              'test("both", async () => {',
              "  try {",
              "    lay();",
              `    const held = ${room};`,
              '    console.log("SAID 1 " + held.look() + " " + (globalThis.lit ?? 0));',
              sweep && `    ${sweep}`,
              next && `    ${next}`,
              `    console.log("SAID 2 " + ${room}.look() + " " + (globalThis.lit ?? 0));`,
              '    console.log("SAID held " + held.look());',
              "  } catch (error) {",
              '    console.log("SAID threw " + error.name);',
              "  }",
              "});",
            ]
              .filter(Boolean)
              .join("\n")
              .replaceAll("KIND", kind);
            const lit =
              'globalThis.lit = (globalThis.lit ?? 0) + 1;\nconsole.log("SAID the body of the lamp runs " + globalThis.lit);\n';
            cases.push({
              name,
              files: {
                "package.json": JSON.stringify({ name: `@made-up/${name}`, private: true, type: "module" }) + "\n",
                "everyday.test.mjs": text + "\n",
                ...(kind === "mjs"
                  ? {
                      "lamp.mjs": lit + 'export const glow = "real";\nexport const shade = () => "own";\n',
                      "room.mjs":
                        'import { glow, shade } from "./lamp.mjs";\nexport const look = () => glow + " " + shade();\n',
                    }
                  : {
                      "lamp.cjs": lit + 'exports.glow = "real";\nexports.shade = () => "own";\n',
                      "room.cjs":
                        'const lamp = require("./lamp.cjs");\nexports.look = () => lamp.glow + " " + lamp.shade();\n',
                    }),
              },
            });
          }
  return cases;
}
