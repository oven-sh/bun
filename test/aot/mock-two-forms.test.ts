import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { expectLayers } from "./harness/layers";
import { reportsToTheRunnerAlone } from "./harness/without-core-dump";
import { test } from "./supported";

const project = () =>
  tempDir("aot-mock-two-forms", {
    "package.json": `{ "name": "forms" }`,
    "both.json": `{ "v": "real" }`,
    "json.json": `{ "v": "real" }`,
    "text.json": `{ "v": "real" }`,
    "later.json": `{ "v": "real" }`,
    "bare.json": `{ "v": "real" }`,
    "first-json.json": `{ "v": "real" }`,
    "first-text.json": `{ "v": "real" }`,
    "throws.json": `{ "v": "real" }`,
    "node_modules/pkg/package.json": `{ "name": "pkg", "main": "index.js", "type": "module" }`,
    "node_modules/pkg/data.json": `{ "v": "real" }`,
    "node_modules/pkg/index.js": `import data from "./data.json" with { type: "json" };
export const ofPackage = () => data.v;
`,
    "lib.mjs": `import both from "./both.json" with { type: "json" };
import bothText from "./both.json" with { type: "text" };
import json from "./json.json" with { type: "json" };
import text from "./text.json" with { type: "text" };
import five from "pkg/data.json" with { type: "json5" };
import bare from "./bare.json";
import firstJSON from "./first-json.json" with { type: "json" };
import firstText from "./first-text.json" with { type: "text" };
import throws from "./throws.json" with { type: "json" };
import bareText from "./bare.json" with { type: "text" };
import { ofPackage } from "pkg";
export const seen = () =>
  [both.v, String(bothText).includes("real"), json.v, String(text).includes("real"), ofPackage(), five.v, bare.v, String(bareText).includes("real")].join(" ");
export const later = async () =>
  [
    firstJSON.v,
    String((await import("./first-json.json", { with: { type: "text" } })).default).includes("real"),
    String(firstText).includes("real"),
    (await import("./first-text.json", { with: { type: "json" } })).default.v,
    throws.v,
    String((await import("./throws.json", { with: { type: "text" } })).default).includes("real"),
    (await import("./later.json", { with: { type: "json" } })).default.v,
    String((await import("./later.json", { with: { type: "text" } })).default).includes("real"),
  ].join(" ");
`,
    "a.test.js": `import { mock, test } from "bun:test";
import { later, seen } from "./lib.mjs";
test("mocks of files that a file of the project loads with types", async () => {
  console.error("SEEN", seen());
  const lay = () => {
    for (const name of ["both", "json", "text", "later", "bare", "first-json", "first-text"]) mock.module("./" + name + ".json", () => ({ default: { v: "MOCK" } }));
    mock.module("pkg/data.json", () => ({ default: { v: "MOCK" } }));
  };
  try {
    mock.module("./throws.json", () => {
      throw new Error("boom");
    });
  } catch {}
  lay();
  console.error("SEEN", seen(), "|", await later());
  mock.restore();
  console.error("SEEN", seen(), "|", await later());
  lay();
  console.error("SEEN", seen(), "|", await later());
});
`,
    "b.test.js": `import { test } from "bun:test";
import { later, seen } from "./lib.mjs";
test("the next file, which mocks nothing", async () => {
  console.error("SEEN", seen(), "|", await later());
});
`,
  });

async function seen(cwd: string, words: string, ...flags: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...flags, "."],
    cwd,
    env: reportsToTheRunnerAlone({ ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words }),
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  if (words.includes("TestRunLayers")) expectLayers(stderr);
  return { lines: stderr.split("\n").filter(line => /^SEEN|^error|^panic|TypeError/.test(line)), exitCode };
}

test("a mock leaves a file alone that is loaded in two forms, over layers too", async () => {
  using dir = project();
  const plain = await seen(String(dir), "");
  expect(plain.lines[1]).toBe(
    "SEEN real true MOCK false real real real true | MOCK false false MOCK real true MOCK false",
  );
  expect(await seen(String(dir), "", "--aot")).toEqual(plain);
  expect(await seen(String(dir), "TestRunLayers:2,TestRunSaysItsForm", "--aot")).toEqual(plain);
}, 120_000);
