import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./run";
import { waysFor } from "./ways";
import { test } from "../supported";

const head = `import { test, vi } from "bun:test";
const say = (...all) => console.log("seen:", ...all);
`;
const m = `console.log("seen: m runs");
let n = 0;
export const who = "real";
export function count() { return ++n; }
`;
const factory = `() => { console.log("seen: factory runs"); return { who: "mock", count: () => "mock" }; }`;
const reader = (name: string, from = "./m.js") => `console.log("seen: ${name} runs");
import { who, count } from "${from}";
export const read = () => who + " " + count();
`;
const namespaceReader = (name: string, from = "./m.js") => `console.log("seen: ${name} runs");
import * as ns from "${from}";
export const read = () => ns.who + " " + ns.count();
export const at = key => ns[key];
`;
const sharesModule = `import { test } from "bun:test";
import "./m.js";
test("other file", () => {});
`;

type Mode = "one program" | "two layers";
type Case = { files: Record<string, string>; flags?: string[]; plain: string[] };

const cases: Record<string, Case> = {
  "a statement linked before the mock": {
    files: {
      "late.js": reader("late"),
      "a.test.js": `${head}import { who, count } from "./m.js";
test("t", async () => {
  vi.doMock("./m.js", ${factory});
  say(who, count());
  await import("./late.js");
  say(who, count());
});
`,
    },
    plain: ["m runs", "real 1", "factory runs", "late runs", "real 2"],
  },
  "a member of a namespace linked before the mock": {
    files: {
      "late.js": reader("late"),
      "a.test.js": `${head}import * as ns from "./m.js";
test("t", async () => {
  vi.doMock("./m.js", ${factory});
  say(ns.who, ns.count());
  await import("./late.js");
  say(ns.who, ns.count());
});
`,
    },
    plain: ["m runs", "real 1", "factory runs", "late runs", "real 2"],
  },
  "another file linked before the mock": {
    files: {
      "old.js": reader("old"),
      "old-ns.js": namespaceReader("old-ns"),
      "late.js": reader("late"),
      "a.test.js": `${head}import { read } from "./old.js";
import { read as readMember } from "./old-ns.js";
test("t", async () => {
  vi.doMock("./m.js", ${factory});
  await import("./late.js");
  say(read(), readMember());
});
`,
    },
    plain: ["m runs", "old runs", "old-ns runs", "factory runs", "late runs", "real 1 real 2"],
  },
  "a file linked behind the mock": {
    files: {
      "late.js": reader("late"),
      "late-ns.js": namespaceReader("late-ns"),
      "a.test.js": `${head}import "./m.js";
test("t", async () => {
  vi.doMock("./m.js", ${factory});
  say((await import("./late.js")).read());
  say((await import("./late-ns.js")).read());
});
`,
    },
    plain: ["m runs", "factory runs", "late runs", "mock mock", "late-ns runs", "mock mock"],
  },
  "through a file that passes the exports on": {
    files: {
      "barrel.js": `export * from "./m.js";\n`,
      "old.js": reader("old", "./barrel.js"),
      "old-ns.js": namespaceReader("old-ns", "./barrel.js"),
      "late.js": reader("late", "./barrel.js"),
      "late-ns.js": namespaceReader("late-ns", "./barrel.js"),
      "late-barrel.js": `export * from "./m.js";\n`,
      "later.js": reader("later", "./late-barrel.js"),
      "later-ns.js": namespaceReader("later-ns", "./late-barrel.js"),
      "a.test.js": `${head}import { read } from "./old.js";
import { read as readMember } from "./old-ns.js";
test("t", async () => {
  vi.doMock("./m.js", ${factory});
  await import("./m.js");
  say("old", read(), readMember());
  say("late, through what was linked before", (await import("./late.js")).read(), (await import("./late-ns.js")).read());
  say("late, through what is linked now", (await import("./later.js")).read(), (await import("./later-ns.js")).read());
  say("by a computed name", (await import("./late-ns.js")).at("who"), (await import("./later-ns.js")).at("who"));
});
`,
    },
    plain: [
      "m runs",
      "old runs",
      "old-ns runs",
      "factory runs",
      "old real 1 real 2",
      "late runs",
      "late-ns runs",
      "late, through what was linked before real 3 real 4",
      "later runs",
      "later-ns runs",
      "late, through what is linked now mock mock mock mock",
      "by a computed name real mock",
    ],
  },
  "through a file that passes two names on": {
    files: {
      "barrel.js": `export { who, count } from "./m.js";\n`,
      "old.js": reader("old", "./barrel.js"),
      "old-ns.js": namespaceReader("old-ns", "./barrel.js"),
      "late.js": reader("late", "./barrel.js"),
      "late-ns.js": namespaceReader("late-ns", "./barrel.js"),
      "late-barrel.js": `export { who, count } from "./m.js";\n`,
      "later.js": reader("later", "./late-barrel.js"),
      "later-ns.js": namespaceReader("later-ns", "./late-barrel.js"),
      "a.test.js": `${head}import { read } from "./old.js";
import { read as readMember } from "./old-ns.js";
test("t", async () => {
  vi.doMock("./m.js", ${factory});
  await import("./m.js");
  say("old", read(), readMember());
  say("late, through what was linked before", (await import("./late.js")).read(), (await import("./late-ns.js")).read());
  say("late, through what is linked now", (await import("./later.js")).read(), (await import("./later-ns.js")).read());
  say("by a computed name", (await import("./late-ns.js")).at("who"), (await import("./later-ns.js")).at("who"));
});
`,
    },
    plain: [
      "m runs",
      "old runs",
      "old-ns runs",
      "factory runs",
      "old real 1 real 2",
      "late runs",
      "late-ns runs",
      "late, through what was linked before real 3 real 4",
      "later runs",
      "later-ns runs",
      "late, through what is linked now mock mock mock mock",
      "by a computed name real mock",
    ],
  },
  "import() and require() behind the mock": {
    files: {
      "a.test.js": `${head}import "./m.js";
test("t", async () => {
  vi.doMock("./m.js", ${factory});
  say((await import("./m.js")).who, require("./m.js").who);
});
`,
    },
    plain: ["m runs", "factory runs", "mock mock"],
  },
  "what vi.importActual() alone had loaded": {
    files: {
      "z.test.js": `import { test } from "bun:test";
test("other file", () => {});
`,
      "a.test.js": `${head}test("t", async () => {
  const actual = await vi.importActual("./m.js");
  vi.doMock("./m.js", ${factory});
  say(actual.who, actual.count());
  say((await import("./m.js")).who, require("./m.js").who);
});
`,
    },
    plain: ["m runs", "real 1", "factory runs", "mock mock"],
  },
  "an object that was read often before the mock": {
    files: {
      "a.test.js": `${head}const read = object => object.who;
test("t", async () => {
  let last;
  for (let i = 0; i < 50; i++) last = read(await import("./m.js"));
  say(last);
  vi.doMock("./m.js", ${factory});
  say(read(await import("./m.js")));
  vi.doUnmock("./m.js");
  say(read(await import("./m.js")));
});
`,
    },
    plain: ["m runs", "real", "factory runs", "mock", "real"],
  },
  "the factory waits for a load that comes to the mock": {
    files: {
      "old.js": reader("old"),
      "a.test.js": `${head}import "./old.js";
test("t", async () => {
  vi.doMock("./m.js", ${factory});
  await import("./old.js");
  say("old is asked for again");
  await import("./m.js");
});
`,
    },
    plain: ["m runs", "old runs", "old is asked for again", "factory runs"],
  },
  "vi.doUnmock() leaves the module as it was": {
    files: {
      "a.test.js": `${head}import { who, count } from "./m.js";
import * as ns from "./m.js";
test("t", async () => {
  vi.doMock("./m.js", ${factory});
  say((await import("./m.js")).who);
  vi.doUnmock("./m.js");
  const back = await import("./m.js");
  say(who, count(), back.who, back.count(), back === ns);
});
`,
    },
    plain: ["m runs", "factory runs", "mock", "real 1 real 2 true"],
  },
  "require() behind vi.doUnmock()": {
    files: {
      "a.test.js": `${head}import { count } from "./m.js";
test("t", () => {
  vi.doMock("./m.js", ${factory});
  say(require("./m.js").who);
  vi.doUnmock("./m.js");
  say(require("./m.js").who, require("./m.js").count(), count());
});
`,
    },
    plain: ["m runs", "factory runs", "mock", "real 1 2"],
  },
  "an object first made under the mock": {
    files: {
      "a.test.js": `${head}import { count } from "./m.js";
const keys = object => Object.keys(object).sort().join("+");
test("t", async () => {
  vi.doMock("./m.js", () => ({ who: "mock", other: 1 }));
  const under = await import("./m.js");
  say(keys(under), under.who);
  vi.doUnmock("./m.js");
  const back = await import("./m.js");
  say(keys(back), back.who, back.count(), count(), back === under);
});
`,
    },
    plain: ["m runs", "other+who mock", "count+who real 1 2 false"],
  },
  "a second mock in the file": {
    files: {
      "silent.js": `import { who } from "./m.js";
export const read = () => who;
`,
      "a.test.js": `${head}import { who } from "./m.js";
test("t", async () => {
  vi.doMock("./m.js", () => ({ who: "mock 1" }));
  say(who, (await import("./silent.js")).read());
  vi.doMock("./m.js", () => ({ who: "mock 2" }));
  await import("./m.js");
  say(who, (await import("./silent.js")).read());
});
`,
    },
    plain: ["m runs", "real mock 1", "real mock 2"],
  },
  "a factory that is declared async": {
    files: {
      "late.js": reader("late"),
      "a.test.js": `${head}import "./m.js";
test("t", async () => {
  vi.doMock("./m.js", async () => {
    await new Promise(done => setTimeout(done, 5));
    return { who: "mock", count: () => "mock" };
  });
  say((await import("./late.js")).read());
});
`,
    },
    plain: ["m runs", "late runs", "mock mock"],
  },
  "a factory that takes the original": {
    files: {
      "late.js": reader("late"),
      "a.test.js": `${head}import { count } from "./m.js";
test("t", async () => {
  vi.doMock("./m.js", async importOriginal => {
    const original = await importOriginal();
    return { who: "mock over " + original.who, count: () => "mock " + original.count() };
  });
  say(count());
  say((await import("./late.js")).read());
  say(count());
});
`,
    },
    plain: ["m runs", "1", "late runs", "mock over real mock 2", "3"],
  },
  "a mock that no load came to": {
    files: {
      "a.test.js": `${head}import { who, count } from "./m.js";
test("t", async () => {
  vi.doMock("./m.js", ${factory});
  vi.doUnmock("./m.js");
  say(who, count(), (await import("./m.js")).count());
});
`,
    },
    plain: ["m runs", "real 1 2"],
  },
  "the next test file": {
    files: {
      "z.test.js": `${head}import { who, count } from "./m.js";
test("next file", async () => {
  say("next file", who, count(), (await import("./m.js")).who);
});
`,
      "a.test.js": `${head}import { who, count } from "./m.js";
test("t", async () => {
  vi.doMock("./m.js", ${factory});
  say((await import("./m.js")).who, who, count());
});
`,
    },
    plain: ["m runs", "factory runs", "mock real 1", "next file real 2 real"],
  },
  "what a preload loaded": {
    flags: ["--preload", "./preload.js"],
    files: {
      "helper.js": reader("helper"),
      "preload.js": `import { read } from "./helper.js";
globalThis.readOfPreload = read;
`,
      "user.js": reader("user"),
      "a.test.js": `${head}import { who } from "./m.js";
import { read } from "./user.js";
vi.mock("./m.js", ${factory});
test("t", () => {
  say("the test file", who, read());
  say("the preload", globalThis.readOfPreload());
});
`,
    },
    plain: [
      "m runs",
      "helper runs",
      "factory runs",
      "user runs",
      "the test file mock mock mock",
      "the preload real 1",
    ],
  },
  "a linked file that has yet to run": {
    files: {
      "first.js": `import { vi } from "bun:test";
import { who } from "./m.js";
console.log("seen: first runs", who);
vi.doMock("./m.js", ${factory});
`,
      "second.js": reader("second"),
      "a.test.js": `${head}import "./first.js";
import { read } from "./second.js";
import { who } from "./m.js";
test("t", () => {
  say(read(), who);
});
`,
    },
    plain: [
      "m runs",
      "first runs real",
      "factory runs",
      "second runs",
      "mock mock mock",
    ],
  },
  "the test file itself has yet to run": {
    files: {
      "first.js": `import { vi } from "bun:test";
import { who } from "./m.js";
console.log("seen: first runs", who);
vi.doMock("./m.js", ${factory});
`,
      "a.test.js": `${head}import "./first.js";
import { who, count } from "./m.js";
test("t", () => {
  say(who, count());
});
`,
    },
    plain: ["m runs", "first runs real", "factory runs", "mock mock"],
  },
  "vi.mock() in a test over what the file loaded": {
    files: {
      "old.js": reader("old"),
      "a.test.js": `${head}import { who, count } from "./m.js";
import { read } from "./old.js";
test("t", async () => {
  say(who, count());
  vi.mock("./m.js", ${factory});
  say(who, count(), read(), (await import("./m.js")).who);
});
`,
    },
    plain: [
      "m runs",
      "old runs",
      "real 1",
      "factory runs",
      "mock mock mock mock mock",
    ],
  },
  "an object held since before the mock": {
    files: {
      "a.test.js": `${head}import * as ns from "./m.js";
const hand = object => object.who + " " + Object.keys(object).sort().join("+");
test("t", async () => {
  const held = await import("./m.js");
  vi.doMock("./m.js", ${factory});
  const mocked = await import("./m.js");
  say(held.who, held.count(), hand(ns), mocked === ns);
});
`,
    },
    plain: ["m runs", "factory runs", "real 1 real count+who false"],
  },
};

// Right as one program and wrong over two layers, on the build in front of the cure. The others were wrong in both ways or in neither: over layers the benches run them.
const wrongOverLayersAlone = [
  "a statement linked before the mock",
  "a member of a namespace linked before the mock",
  "require() behind vi.doUnmock()",
  "an object first made under the mock",
  "a second mock in the file",
  "a factory that takes the original",
  "the next test file",
];
for (const name of wrongOverLayersAlone)
  if (!(name in cases)) throw new Error(`no case of mock-views is called ${name}`);
const modes: [Mode, string][] = [
  ["one program", "TestRunLayers:0"],
  ["two layers", "TestRunLayers:2"],
];

export function mockViews(part: number, of: number) {
  const mine = Object.entries(cases).filter((_, index) => index % of === part);
  for (const [name, { files, flags = [], plain: expected }] of mine) {
    test(
      name,
      async () => {
        using dir = tempDir("aot-mock-views", {
          "package.json": `{ "type": "module" }`,
          "m.js": m,
          "z.test.js": sharesModule,
          ...files,
        });
        const seenWith = async (words: string, ...more: string[]) => {
          const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, ...more], String(dir), {
            ...bunEnv,
            BUN_DEBUG_TEST_AOT_WORDS: words,
          });
          return {
            lines: stdout
              .split("\n")
              .filter(line => line.startsWith("seen: "))
              .map(line => line.slice("seen: ".length)),
            failed: stderr.split("\n").filter(line => /^\(fail\)|^✗|^panic|^error: /.test(line)),
            exitCode,
          };
        };
        const asked = waysFor(modes, wrongOverLayersAlone.includes(name));
        const [plain, ...compiled] = await Promise.all([
          seenWith("TestRunLayers:0"),
          ...asked.map(([, words]) => seenWith(words, "--aot")),
        ]);
        expect(plain).toEqual({ lines: expected, failed: [], exitCode: 0 });
        for (const [index, [mode]] of asked.entries()) expect({ mode, ...compiled[index] }).toEqual({ mode, ...plain });
      },
      180_000,
    );
  }
}
