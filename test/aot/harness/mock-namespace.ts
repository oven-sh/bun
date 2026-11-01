import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "../supported";
import { expectLayers } from "./layers";
import { run } from "./run";

// `vi.doMock()` over a module that has run leaves the module alone. From then on the module has two namespace objects: its own, which whoever was linked to it before keeps,
// and the mock's, which a load by name gets, and whoever is linked behind the mock. Neither turns into the other, whatever comes later.
const head = `import { spyOn, test, vi } from "bun:test";
const say = (...all) => console.log("seen:", ...all);
const show = f => { try { return String(f()); } catch { return "threw"; } };
const face = o => [show(() => o.flag), show(() => o["fl" + "ag"]), show(() => o.other), show(() => Object.keys(o).join("+")), "added" in o, show(() => JSON.stringify(o)), show(() => ({ ...o }).flag)].join(" ");
`;
const dep = `export const flag = "real";
export function f() { return "real f"; }
export let count = 0;
export function bump() { count++; }
`;
const lay = `vi.doMock("./dep.js", () => ({ flag: "mock", added: 1 }));`;
const barrel = `export * as inner from "./dep.js";\n`;

// What face() says of the object of the module, and of the object of the mock.
const real = `real real undefined bump+count+f+flag false {"count":0,"flag":"real"} real`;
const mock = "mock mock threw flag+added true threw mock";

type Case = { files: Record<string, string>; plain: string[] };

const cases: Record<string, Case> = {
  "the object that a test file holds": {
    files: {
      "a.test.js": `${head}import * as ns from "./dep.js";
test("t", async () => {
  ${lay}
  say("laid", face(ns));
  const mocked = await import("./dep.js");
  say(mocked === ns, mocked === (await import("./dep.js")));
  say("mock's", face(mocked));
  say("held", face(ns));
});
`,
    },
    plain: [`laid ${real}`, "false true", `mock's ${mock}`, `held ${real}`],
  },
  "a file linked before the mock and one linked behind it": {
    files: {
      "early.js": `import * as ns from "./dep.js";\nexport const early = () => ns;\nexport const earlyAt = key => ns[key];\n`,
      "late.js": `import * as ns from "./dep.js";\nexport const late = () => ns;\nexport const lateAt = key => ns[key];\n`,
      "a.test.js": `${head}import { early, earlyAt } from "./early.js";
test("t", async () => {
  ${lay}
  const { late, lateAt } = await import("./late.js");
  const mocked = await import("./dep.js");
  say(late() === early(), late() === mocked, early() === mocked, earlyAt("flag"), show(() => earlyAt("added")), lateAt("flag"), lateAt("added"));
  say("late", face(late()));
  say("early", face(early()));
});
`,
    },
    plain: ["false true false real undefined mock 1", `late ${mock}`, `early ${real}`],
  },
  "the object of a mock keeps that mock": {
    files: {
      "a.test.js": `${head}import * as ns from "./dep.js";
test("t", async () => {
  ${lay}
  const one = await import("./dep.js");
  vi.doMock("./dep.js", () => ({ flag: "second", more: 2 }));
  const two = await import("./dep.js");
  say(one === two, one === ns, two === ns);
  vi.doUnmock("./dep.js");
  const back = await import("./dep.js");
  say(back === ns);
  say("one", face(one));
  say("two", face(two));
  say("held", face(ns));
});
`,
    },
    plain: [
      "false false false",
      "true",
      `one ${mock}`,
      "two second second threw flag+more false threw second",
      `held ${real}`,
    ],
  },
  "the link of the file that hands the object on decides": {
    files: {
      "barrel.js": barrel,
      "late.js": `import { inner } from "./barrel.js";\nimport * as b from "./barrel.js";\nexport const all = key => [inner, b.inner, b[key]];\n`,
      "late-barrel.js": barrel,
      "a.test.js": `${head}import { inner } from "./barrel.js";
import * as b from "./barrel.js";
test("t", async () => {
  ${lay}
  const mocked = await import("./dep.js");
  say(inner === mocked, b.inner === inner, b["inn" + "er"] === inner, (await import("./barrel.js")).inner === inner);
  say((await import("./late.js")).all("inner").map(object => object === inner).join(" "));
  say((await import("./late-barrel.js")).inner === mocked);
  say("inner", face(inner));
});
`,
    },
    plain: ["false true true true", "true true true", "true", `inner ${real}`],
  },
  "the original is the module": {
    files: {
      "a.test.js": `${head}import * as ns from "./dep.js";
test("t", async () => {
  let original;
  vi.doMock("./dep.js", async importOriginal => { original = await importOriginal(); return { ...original, flag: "mock" }; });
  say((await vi.importActual("./dep.js")) === ns);
  const mocked = await import("./dep.js");
  say(original === ns, mocked === ns, mocked.flag, mocked.f(), (await vi.importActual("./dep.js")) === ns);
});
`,
    },
    plain: ["true", "true false mock real f true"],
  },
  "the held object is live, and a spy on it reaches the module": {
    files: {
      "user.js": `import { f } from "./dep.js";\nexport const call = () => f();\n`,
      "a.test.js": `${head}import * as ns from "./dep.js";
import { call } from "./user.js";
test("t", async () => {
  ${lay}
  const mocked = await import("./dep.js");
  ns.bump();
  say(ns.count, ns["cou" + "nt"], show(() => mocked.count), show(() => { ns.flag = 1; }), show(() => { mocked.flag = "written"; return mocked.flag; }), ns.flag);
  const spy = spyOn(ns, "f").mockReturnValue("spied");
  say(ns.f(), call(), spy.mock.calls.length, show(() => mocked.f));
  spy.mockRestore();
  say(ns.f(), call());
});
`,
    },
    plain: ["1 1 threw threw written real", "spied spied 2 threw", "real f real f"],
  },
  "the next test file gets the same object of the module": {
    files: {
      "a.test.js": `${head}import * as ns from "./dep.js";
test("a", async () => {
  ${lay}
  globalThis.kept = { ns, mocked: await import("./dep.js") };
  say("a", globalThis.kept.mocked === ns);
});
`,
      "b.test.js": `${head}import * as ns from "./dep.js";
test("b", async () => {
  const now = await import("./dep.js");
  say("b", now === ns, ns === globalThis.kept?.ns, now === globalThis.kept?.mocked);
  say("b held", face(ns));
  if (globalThis.kept) say("b mock's", face(globalThis.kept.mocked));
});
`,
    },
    plain: ["a false", "b true true false", `b held ${real}`, `b mock's ${mock}`],
  },
  "reads in loops, before, under and behind the mock": {
    files: {
      "a.test.js": `${head}import * as ns from "./dep.js";
const read = (object, key) => object[key];
test("t", async () => {
  let before = "", held = "", ofMock = "", after = "", kept = "";
  for (let i = 0; i < 300; i++) before = read(ns, "flag") + ns.flag;
  ${lay}
  const mocked = await import("./dep.js");
  for (let i = 0; i < 300; i++) { held = read(ns, "flag") + ns.flag; ofMock = read(mocked, "flag") + mocked.flag; }
  vi.doUnmock("./dep.js");
  for (let i = 0; i < 300; i++) { after = read(ns, "flag") + ns.flag; kept = read(mocked, "flag") + mocked.flag; }
  say(before, held, ofMock, after, kept);
});
`,
    },
    plain: ["realreal realreal mockmock realreal mockmock"],
  },
};

export function mockNamespace(part: number, of: number) {
  const mine = Object.entries(cases).filter((_, index) => index % of === part);
  for (const [name, { files, plain: expected }] of mine) {
    test(
      name,
      async () => {
        using dir = tempDir("aot-mock-namespace", { "package.json": `{ "type": "module" }`, "dep.js": dep, ...files });
        const seenWith = async (...flags: string[]) => {
          const environment = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunSaysItsForm" };
          const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), environment);
          // A parallel run prints what its test files log to stderr, in the order in which they end.
          const lines = (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("seen: "));
          const failed = stderr.split("\n").filter(line => /^\(fail\)|^✗|^panic|^error: /.test(line));
          return { seen: { lines: lines.map(line => line.slice("seen: ".length)), failed, exitCode }, stderr };
        };
        const sorted = (seen: { lines: string[] }) => ({ ...seen, lines: seen.lines.toSorted() });
        const [plain, oneProgram, plainInParallel, layers] = await Promise.all([
          seenWith(),
          seenWith("--aot"),
          seenWith("--parallel=2"),
          // More source than fits the memory as one program: the run is built in layers.
          seenWith("--aot", "--parallel=2", "--aot-memory-limit=1KB"),
        ]);
        expect(plain.seen).toEqual({ lines: expected, failed: [], exitCode: 0 });
        expect(oneProgram.seen).toEqual(plain.seen);
        expectLayers(layers.stderr);
        expect(sorted(layers.seen)).toEqual(sorted(plainInParallel.seen));
      },
      180_000,
    );
  }
}
