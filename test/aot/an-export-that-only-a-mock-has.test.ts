import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// mock.module("./other.ts", () => ({ v, extra })) before anything has loaded other.ts: what the factory answers is the whole module.
// `extra`, which other.ts does not export, is a name of the namespace object, and `f`, which the factory leaves out, is none.
const files = {
  "package.json": `{ "name": "an-export-that-only-a-mock-has" }`,
  "other.ts": `export const v = "real v";
export function f() {
  return "real f";
}
export default "real default";
`,
  "late.ts": `export const v = "real v";
export let count = 0;
`,
  "data.txt": "real text\n",
  "data.json": `{ "name": "real" }\n`,
  "plain.mjs": `export const name = "real";\n`,
  "marked.mjs": `export const name = "real";\n`,
  "unmarked.mjs": `export const name = "real";\n`,
  "user.ts": `import * as whole from "./other.ts";
export function seen() {
  return [whole.v, (whole as any).extra, "extra" in whole, "f" in whole, Object.keys(whole).join()].join(" ");
}
`,
  "mocks.test.ts": `import { test, mock, spyOn } from "bun:test";
test("ahead of the load", async () => {
  mock.module("./other.ts", () => ({ v: "first v", first: 1 }));
  mock.module("./other.ts", () => ({ v: "mocked v", zeta: 1, extra: "extra", alpha: () => "alpha", 0: "zero", "a-b": "dash", [Symbol.for("s")]: 1 }));
  const T: any = await import("./other.ts");
  console.log("R=values", T.v, T.extra, T.zeta, typeof T.alpha, T.alpha?.(), T.f, T.default, T.first, T[0], T["a-b"]);
  console.log("R=keys", Object.keys(T).join(), "|", Reflect.ownKeys(T).map(String).join(), "|", Object.getOwnPropertyNames(T).join());
  console.log("R=in", "extra" in T, "v" in T, "f" in T, "first" in T, "nothing" in T, Object.hasOwn(T, "extra"), Object.hasOwn(T, "f"));
  console.log("R=descriptor", JSON.stringify(Object.getOwnPropertyDescriptor(T, "extra")), JSON.stringify(Object.getOwnPropertyDescriptor(T, "f")));
  console.log("R=copies", JSON.stringify({ ...T }), JSON.stringify(Object.entries(T).map(([key, value]) => [key, typeof value])));
  const name = ["ex", "tra"].join("");
  console.log("R=computed", T[name], Reflect.get(T, name), Reflect.has(T, name));
  let written = "no throw";
  try {
    T.extra = 2;
  } catch (error: any) {
    written = error.constructor.name;
  }
  console.log("R=write", written, T.extra, Object.isSealed(T), Object.isExtensible(T));
  const { extra, zeta } = T;
  console.log("R=pattern", extra, zeta);
  console.log("R=again", (await import("./other.ts")) === T, require("./other.ts").extra, Object.keys(require("./other.ts")).join());
  console.log("R=user", (await import("./user.ts")).seen());
  for (const key in T) console.log("R=for-in", key);

  mock.module("./other.ts", () => ({ v: "again v", extra: "extra 2", later: 1 }));
  const U: any = await import("./other.ts");
  console.log("R=behind", U === T, U.v, U.extra, U.later, "later" in U, Object.keys(U).join());
  spyOn(T, "alpha").mockReturnValue("spied");
  console.log("R=spied", T.alpha());
  spyOn(T, "nothing");
  console.log("R=spy on nothing", "nothing" in T, Object.keys(T).join());
});
test("data files and the mark of an ES module", async () => {
  const show = (label: string, T: any) =>
    console.log("R=" + label, JSON.stringify(T), Object.keys(T).join(), Object.prototype.toString.call(T), T.name, T.extra, T.__esModule, "__esModule" in T, "extra" in T);
  mock.module("./data.txt", () => ({ default: "mock", name: "mock" }));
  show("txt require", require("./data.txt"));
  show("txt import", await import("./data.txt"));
  mock.module("./data.json", () => ({ default: "mock", name: "mock", extra: 1 }));
  show("json require", require("./data.json"));
  show("json import", await import("./data.json"));
  mock.module("./plain.mjs", () => ({ extra: 1, name: "mock" }));
  show("mjs require", require("./plain.mjs"));
  show("mjs import", await import("./plain.mjs"));
  console.log("R=one object", require("./plain.mjs") === require("./plain.mjs"), Object.isExtensible(require("./plain.mjs")));
  mock.module("./marked.mjs", () => ({ __esModule: true, name: "mock" }));
  show("marked require", require("./marked.mjs"));
  show("marked import", await import("./marked.mjs"));
  mock.module("./unmarked.mjs", () => ({ __esModule: false, name: "mock" }));
  show("unmarked import", await import("./unmarked.mjs"));
  show("unmarked require", require("./unmarked.mjs"));
});
test("behind the first load", async () => {
  const R: any = await import("./late.ts");
  mock.module("./late.ts", () => ({ v: "mocked v", extra: "extra" }));
  const T: any = await import("./late.ts");
  console.log("R=late", T === R, T.v, T.extra, T.count, Object.keys(T).join(), "extra" in T, "count" in T);
});
`,
};

test.each(["TestRunLayers:0", "TestRunLayers:2,TestRunPartFiles:1"])(
  "every line is as in plain bun test: %s",
  async words => {
    using dir = tempDir("aot-an-export-that-only-a-mock-has", files);
    const seenWith = async (...flags: string[]) => {
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), {
        ...bunEnv,
        BUN_DEBUG_TEST_AOT_WORDS: words,
      });
      return {
        lines: stdout.split("\n").filter(line => line.startsWith("R=")),
        failed: stderr.split("\n").filter(line => /^\(fail\)|^✗|^panic/.test(line)),
        exitCode,
      };
    };
    const [plain, compiled] = await Promise.all([seenWith(), seenWith("--aot")]);
    expect(plain.lines).toContain("R=values mocked v extra 1 function alpha undefined undefined undefined zero dash");
    expect(plain.lines).toContain("R=in true true false false false true false");
    expect(plain.lines.length).toBe(31);
    expect(compiled).toEqual(plain);
  },
  120_000,
);
