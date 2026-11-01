import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const numbers = Array.from({ length: 13 }, (_, index) => index + 1);
const files: Record<string, string> = {
  "package.json": `{}`,
  ...Object.fromEntries(numbers.map(n => [`e${n}.mjs`, `export const x = ${n};\nexport default ${n};\n`])),
  "r.cjs": numbers.map(n => `exports.e${n} = () => require("./e${n}.mjs");\n`).join(""),
  "star8.mjs": `export * from "./e8.mjs";\n`,
  "below13.mjs": `import * as below from "./e13.mjs";\nexport const seenBelow = Object.isExtensible(below);\n`,
  "inner.mjs": `import r from "./r.cjs";
console.log("seen: inner, star above", Object.isExtensible(r.e5()));
`,
  "main.test.mjs": `import { test } from "bun:test";
import * as one from "./e1.mjs";
import * as two from "./e2.mjs";
import { x as three } from "./e3.mjs";
export * as four from "./e4.mjs";
import * as five from "./e5.mjs";
import "./inner.mjs";
import seven from "./e7.mjs";
import { x as eight } from "./star8.mjs";
import "./e9.mjs";
import { x as ten } from "./e10.mjs";
import { x as eleven } from "./e11.mjs";
import { x as twelve } from "./e12.mjs";
import { x as thirteen } from "./e13.mjs";
import { seenBelow } from "./below13.mjs";
import r from "./r.cjs";
console.log("seen: star, used as a value", Object.isExtensible(r.e1()), r.e1() === one);
console.log("seen: star, members only", Object.isExtensible(r.e2()), two.x);
console.log("seen: a name", Object.isExtensible(r.e3()), three);
console.log("seen: export star as", Object.isExtensible(r.e4()));
console.log("seen: the star itself", Object.isExtensible(five));
const six = await import("./e6.mjs");
console.log("seen: import()", Object.isExtensible(r.e6()), r.e6() === six);
console.log("seen: a default import", Object.isExtensible(r.e7()), seven);
console.log("seen: export star from", Object.isExtensible(r.e8()), eight);
console.log("seen: for effects alone", Object.isExtensible(r.e9()));
const imported = await import("./e10.mjs");
console.log("seen: a name, import(), then require", Object.isExtensible(r.e10()), r.e10() === imported, ten);
const required = r.e11();
console.log("seen: a name, require, then import()", Object.isExtensible(required), (await import("./e11.mjs")) === required, eleven);
console.log("seen: require in the test file", Object.isExtensible(import.meta.require("./e12.mjs")), import.meta.require("./e12.mjs") === r.e12(), twelve);
console.log("seen: a star import below", seenBelow, Object.isExtensible(r.e13()), thirteen);
test("end", () => {});
`,
};

test("require() of an ES module answers as in plain bun test", async () => {
  using dir = tempDir("aot-namespace-over-layers", files);
  const seenWith = async (words: string, ...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), {
      ...bunEnv,
      BUN_DEBUG_TEST_AOT_WORDS: words,
    });
    return {
      lines: stdout.split("\n").filter(line => line.startsWith("seen: ")),
      failed: stderr.split("\n").filter(line => /^\(fail\)|^✗|^panic/.test(line)),
      exitCode,
    };
  };
  const [plain, oneProgram, twoLayers, threeLayers] = await Promise.all([
    seenWith("TestRunLayers:0"),
    seenWith("TestRunLayers:0", "--aot"),
    seenWith("TestRunLayers:2,TestRunPartFiles:1", "--aot"),
    seenWith("TestRunLayers:3,TestRunPartFiles:1", "--aot"),
  ]);
  expect(plain).toEqual({
    lines: [
      "seen: inner, star above false",
      "seen: star, used as a value false true",
      "seen: star, members only false 2",
      "seen: a name true 3",
      "seen: export star as true",
      "seen: the star itself false",
      "seen: import() false true",
      "seen: a default import true 7",
      "seen: export star from true 8",
      "seen: for effects alone true",
      "seen: a name, import(), then require false true 10",
      "seen: a name, require, then import() true true 11",
      "seen: require in the test file true true 12",
      "seen: a star import below false false 13",
    ],
    failed: [],
    exitCode: 0,
  });
  expect(oneProgram).toEqual(plain);
  expect(twoLayers).toEqual(plain);
  expect(threeLayers).toEqual(plain);
}, 180_000);
