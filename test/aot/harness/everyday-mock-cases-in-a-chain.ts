// A third cross of tests with mocks, beside everyday-mock-cases.ts: mocks in a chain, and what happens while a load is under way. Each case is a project of its own.
//
// A `spring` is mocked. A `brook` asks for the spring, a `river` for the brook; with two or three in the chain the brook and the river are mocked too, each by a factory that asks for the one before. The body of
// the spring, or the factory over it, waits at a `sluice`. The test begins to load the spring, then the last of the chain, does something meanwhile, and opens the sluice. It prints what the two loads gave, what a
// new load of the spring and of the brook gives, and which bodies ran.
import type { EverydayMockCase } from "./everyday-mock-cases";

const lines = (...all: (string | false | string[])[]) => all.flat().filter(line => line !== false).join("\n") + "\n"; // prettier-ignore
const ran = (name: string) => `(globalThis.ran ??= []).push(${JSON.stringify(name)});`;
const waits = "await globalThis.sluice;";
const exportsOf = (word: string, name: string) => [
  `export const name = ${JSON.stringify(`${word} ${name}`)};`,
  `export const flow = x => ${JSON.stringify(word + " ")} + x;`,
];

// How the next in the chain asks for the spring.
const asks: Record<string, string> = {
  "imported-at-run-time": 'await import("./spring.mjs")',
  "required": "fetched()",
  "imported": "",
  "the-original-asked-for": 'await vi.importActual("./spring.mjs")',
};

const overTheSpring = (mocked: string, asked: string): string[] =>
  ({
    "bare": ['vi.doMock("./spring.mjs");'],
    "a-file-among-the-mocks": ['vi.doMock("./spring.mjs");'],
    "a-spy": ['vi.doMock("./spring.mjs", { spy: true });'],
    "a-factory-over-the-original": [
      'vi.doMock("./spring.mjs", async importOriginal => {',
      "  const original = await importOriginal();",
      ...(asked === "required" ? [`  ${waits}`] : []),
      '  return { ...original, name: "mocked spring" };',
      "});",
    ],
    "a-factory-that-waits": [
      'vi.doMock("./spring.mjs", async () => {',
      `  ${waits}`,
      '  return { name: "mocked spring", flow: x => "mocked " + x };',
      "});",
    ],
  })[mocked]!;

const overTheBrook = (asked: string) =>
  asked === "imported"
    ? ['vi.doMock("./brook.mjs", async importOriginal => ({ ...(await importOriginal()), more: 1 }));']
    : [
        'vi.doMock("./brook.mjs", async () => {',
        `  const spring = ${asks[asked]};`,
        '  return { name: "brook out of " + spring.name, flow: x => "mocked brook " + x };',
        "});",
      ];

const overTheRiver = [
  'vi.doMock("./river.mjs", async () => {',
  '  const brook = await import("./brook.mjs");',
  '  return { name: "river out of " + brook.name, flow: x => "mocked river " + x };',
  "});",
];

export function mocksInAChain(): EverydayMockCase[] {
  const cases: EverydayMockCase[] = [];
  for (const mocked of [
    "bare",
    "a-spy",
    "a-file-among-the-mocks",
    "a-factory-over-the-original",
    "a-factory-that-waits",
  ])
    for (const asked of Object.keys(asks))
      for (const [length, links] of Object.entries({ "one": 1, "two": 2, "three": 3 }))
        for (const how of [
          "laid-in-the-test",
          "loads-begun-in-another-file",
          "laid-in-a-preload",
          "modules-reset-meanwhile",
          "unmocked-meanwhile",
        ]) {
          const isRequired = asked === "required";
          const atTheSluice = !isRequired && waits;
          const lays = [...overTheSpring(mocked, asked), ...(links > 1 ? overTheBrook(asked) : []), ...(links > 2 ? overTheRiver : [])]; // prettier-ignore
          const elsewhere = how === "loads-begun-in-another-file";
          const inAPreload = how === "laid-in-a-preload";
          const begin = (name: string) => (elsewhere ? `begins.${name}()` : `import("./${name}.mjs")`);
          const last = links > 2 ? "river" : "brook";
          const fetches = isRequired && links > 1 && 'import { fetched } from "./fetch.cjs";';
          const name = `${mocked}--${asked}--${length}--${how}`;
          cases.push({
            name,
            files: {
              "package.json": JSON.stringify({ name: `@made-up/${name}`, private: true }) + "\n",
              "spring.mjs": lines(
                ran("spring"),
                mocked !== "a-file-among-the-mocks" && atTheSluice,
                exportsOf("real", "spring"),
              ),
              ...(mocked === "a-file-among-the-mocks" && {
                "__mocks__/spring.mjs": lines(
                  ran("the file among the mocks"),
                  atTheSluice,
                  exportsOf("stored", "spring"),
                ),
              }),
              "brook.mjs":
                asked === "imported"
                  ? lines('import * as spring from "./spring.mjs";', ran("brook"), 'export const name = "brook over " + spring.name;', exportsOf("brook", "")[1]) // prettier-ignore
                  : links > 1
                    ? lines(ran("brook"), exportsOf("real", "brook")[0], exportsOf("brook", "")[1])
                    : lines(
                        isRequired && 'import { fetched } from "./fetch.cjs";',
                        asked === "the-original-asked-for" && 'import { vi } from "bun:test";',
                        ran("brook"),
                        `const spring = ${asks[asked]};`,
                        'export const name = "brook out of " + spring.name;',
                        exportsOf("brook", "")[1],
                      ),
              ...(links > 2 && {
                "river.mjs": lines(ran("river"), exportsOf("real", "river")[0], exportsOf("river", "")[1]),
              }),
              ...(isRequired && {
                "fetch.cjs": elsewhere
                  ? lines('const own = require("node:module").createRequire(__filename);', 'exports.fetched = () => own("./spring.mjs");') // prettier-ignore
                  : lines('exports.fetched = () => require("./spring.mjs");'),
              }),
              ...(elsewhere && {
                "begins.mjs": lines(
                  "export const begins = {",
                  ["spring", "brook", ...(links > 2 ? ["river"] : [])].map(
                    one => `  ${one}: () => import("./${one}.mjs"),`,
                  ),
                  "};",
                ),
              }),
              ...(inAPreload && {
                "bunfig.toml": '[test]\npreload = ["./laid-first.mjs"]\n',
                "laid-first.mjs": lines('import { vi } from "bun:test";', fetches, lays),
              }),
              ...Object.fromEntries(
                Array.from({ length: 8 }, (_, at) => [`pebble-${at}.mjs`, `export const pebble = ${at};\n`]),
              ),
              "everyday.test.js": lines(
                'import { test, vi } from "bun:test";',
                !inAPreload && fetches,
                elsewhere && 'import { begins } from "./begins.mjs";',
                `const pebbles = [${Array.from({ length: 8 }, (_, at) => `() => import("./pebble-${at}.mjs")`).join(", ")}];`,
                "// Loads of files that nobody has seen, and turns of the loop, give whatever is under way the time to come as far as it can.",
                "async function settle() {",
                "  for (let turn = 0; turn < 4; turn++) await pebbles.shift()();",
                "  for (let turn = 0; turn < 6; turn++) await new Promise(done => setImmediate(done));",
                "}",
                "function shown(found) {",
                "  try {",
                '    return `${found.name}, ${found.flow(2)}, ${found.flow.mock ? "a mock" : "no mock"}`;',
                "  } catch (error) {",
                '    return "showing it threw " + error.name;',
                "  }",
                "}",
                'test("the chain", async () => {',
                "  globalThis.ran = [];",
                "  let open;",
                "  globalThis.sluice = new Promise(done => (open = done));",
                '  const tooLate = new Promise(done => setTimeout(done, 700, "does not come"));',
                '  const outcome = load => Promise.race([load.then(shown, error => "threw " + error.name), tooLate]);',
                !inAPreload && lays.map(line => "  " + line),
                `  const spring = outcome(${begin("spring")});`,
                "  await settle();",
                `  const last = outcome(${begin(last)});`,
                "  await settle();",
                how === "modules-reset-meanwhile" && "  vi.resetModules();",
                how === "unmocked-meanwhile" && '  vi.doUnmock("./spring.mjs");',
                "  open();",
                '  console.log("SAID the spring: " + (await spring));',
                `  console.log("SAID the ${last}: " + (await last));`,
                `  console.log("SAID the spring anew: " + (await outcome(${begin("spring")})));`,
                `  console.log("SAID the brook anew: " + (await outcome(${begin("brook")})));`,
                // A branch that is never taken: a compiler that folds it the wrong way changes the line.
                "  let ran = globalThis.ran.join();",
                '  if (process.argv.length > 99) ran = "a long command line";',
                '  console.log("SAID ran: " + ran);',
                "});",
              ),
            },
          });
        }
  return cases;
}
