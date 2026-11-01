import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const head = `import { test, vi } from "bun:test";
const say = (...all) => console.log("seen:", ...all);
`;
const m = `console.log("seen: m runs");
let n = 0;
exports.who = "real";
exports.count = () => ++n;
`;
const factory = `() => { console.log("seen: factory runs"); return { who: "mock", count: () => "mock" }; }`;
const reader = (name: string) => `console.log("seen: ${name} runs");
import { who, count } from "./m.cjs";
import * as ns from "./m.cjs";
export const read = () => [who, count(), ns.who, Object.keys(ns).sort().join("+")].join(" ");
`;

type Case = { files: Record<string, string>; plain: string[] };

// `vi.doMock()` leaves a CommonJS file that has run as it is. Whoever was linked to it keeps it; whoever asks by name, or is linked behind the mock, gets the mock.
const cases: Record<string, Case> = {
  "a statement and a namespace linked before the mock": {
    files: {
      "old.js": reader("old"),
      "late.js": reader("late"),
      "a.test.js": `${head}import { read } from "./old.js";
test("t", async () => {
  vi.doMock("./m.cjs", ${factory});
  say(read());
  say((await import("./late.js")).read());
  say(read());
});
`,
    },
    plain: [
      "m runs",
      "old runs",
      "real 1 real count+default+who",
      "factory runs",
      "late runs",
      "mock mock mock count+who",
      "real 2 real count+default+who",
    ],
  },
  "import() and require() by name": {
    files: {
      "old.js": reader("old"),
      "a.test.js": `${head}import { read } from "./old.js";
test("t", async () => {
  vi.doMock("./m.cjs", ${factory});
  const mocked = await import("./m.cjs");
  say(mocked.who, Object.keys(mocked).sort().join("+"), import.meta.require("./m.cjs").who);
  say(read());
});
`,
    },
    plain: ["m runs", "old runs", "factory runs", "mock count+who mock", "real 1 real count+default+who"],
  },
  "the mock ends": {
    files: {
      "old.js": reader("old"),
      "a.test.js": `${head}import { read } from "./old.js";
test("t", async () => {
  vi.doMock("./m.cjs", ${factory});
  say((await import("./m.cjs")).who);
  vi.doUnmock("./m.cjs");
  const back = await import("./m.cjs");
  say(back.who, back.count(), import.meta.require("./m.cjs").count(), read());
});
`,
    },
    plain: ["m runs", "old runs", "factory runs", "mock", "real 1 2 real 3 real count+default+who"],
  },
  "a second mock": {
    files: {
      "old.js": reader("old"),
      "a.test.js": `${head}import { read } from "./old.js";
test("t", async () => {
  vi.doMock("./m.cjs", ${factory});
  say((await import("./m.cjs")).who);
  vi.doMock("./m.cjs", () => ({ who: "second" }));
  say((await import("./m.cjs")).who, import.meta.require("./m.cjs").who, read());
});
`,
    },
    plain: ["m runs", "old runs", "factory runs", "mock", "second second real 1 real count+default+who"],
  },
  "the next file": {
    files: {
      "old.js": reader("old"),
      "a.test.js": `${head}import { read } from "./old.js";
test("t", async () => {
  vi.doMock("./m.cjs", ${factory});
  say((await import("./m.cjs")).who, read());
});
`,
      "b.test.js": `${head}import { who, count } from "./m.cjs";
test("t", () => say(who, typeof count()));
`,
    },
    plain: ["m runs", "old runs", "factory runs", "mock real 1 real count+default+who", "real number"],
  },
};

for (const [name, { files, plain: expected }] of Object.entries(cases)) {
  test(
    name,
    async () => {
      using dir = tempDir("aot-mock-views-cjs", { "package.json": `{ "type": "module" }`, "m.cjs": m, ...files });
      const seenWith = async (words: string, ...more: string[]) => {
        const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...more], String(dir), {
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
      const [plain, oneProgram, twoLayers] = await Promise.all([
        seenWith("TestRunLayers:0"),
        seenWith("TestRunLayers:0", "--aot"),
        seenWith("TestRunLayers:2", "--aot"),
      ]);
      expect(plain).toEqual({ lines: expected, failed: [], exitCode: 0 });
      expect({ mode: "one program", ...oneProgram }).toEqual({ mode: "one program", ...plain });
      expect({ mode: "two layers", ...twoLayers }).toEqual({ mode: "two layers", ...plain });
    },
    180_000,
  );
}
