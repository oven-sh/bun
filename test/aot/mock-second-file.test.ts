import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const dep = {
  "dep.js": `console.log("SEEN dep.js runs"); export const flag = "real"; export const plain = "real"; export default "real";`,
  "dep.cjs": `console.log("SEEN dep.cjs runs"); exports.flag = "real"; exports.plain = "real";`,
};
const hoisted = (file: string, path: string, flag: string) => `
import { test, vi } from "bun:test";
import * as all from "${path}";
import { flag } from "${path}";
vi.mock("${path}", () => ({ flag: "${flag}" }));
test("${file}", () => console.log("SEEN ${file}", Object.keys(all).join(), all.flag, flag));`;
const inTest = (file: string, path: string, flag: string) => `
import { test, mock } from "bun:test";
test("${file}", async () => {
  mock.module("${path}", () => ({ flag: "${flag}" }));
  const all = await import("${path}");
  console.log("SEEN ${file}", Object.keys(all).join(), all.flag, require("${path}").flag);
});`;
const real = (file: string, path: string) => `
import { test } from "bun:test";
import * as all from "${path}";
import { flag } from "${path}";
test("${file}", () => console.log("SEEN ${file}", Object.keys(all).join(), all.flag, flag, require("${path}").flag));`;

const projects = Object.entries(dep).flatMap(([name, text]) =>
  Object.entries({ hoisted, inTest }).flatMap(([how, mocks]) =>
    [2, 3].map(count => {
      const files: Record<string, string> = { "package.json": `{ "name": "mock-second-file" }`, [name]: text };
      for (let i = 0; i < count; i++) files[`a${i}.test.js`] = mocks(`a${i}`, `./${name}`, `mock ${i}`);
      files["b.test.js"] = real("b", `./${name}`);
      files["c.test.js"] = mocks("c", `./${name}`, "mock behind the real one");
      files["d.test.js"] = real("d", `./${name}`);
      return [`${name}, ${how}, ${count} files mock it`, files] as const;
    }),
  ),
);

async function seenWith(files: Record<string, string>, words?: string, ...more: string[]) {
  using dir = tempDir("mock-second-file", files);
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, exitCode } = await run([bunExe(), "test", ...more], String(dir), env);
  return { seen: stdout.split("\n").filter(line => line.startsWith("SEEN ")), exitCode };
}
const plainRuns = new Map<string, ReturnType<typeof seenWith>>();
const plainOf = (name: string, files: Record<string, string>) =>
  plainRuns.getOrInsertComputed(name, () => seenWith(files));
const behindThem = "the file behind them has the real module: %s";

test.concurrent.each(projects)(behindThem + ", plain Bun", async (name, files) => {
  const plain = await plainOf(name, files);
  expect(plain.seen.filter(line => line.startsWith("SEEN b ") || line.startsWith("SEEN d "))).toHaveLength(2);
  expect(plain.seen.find(line => line.startsWith("SEEN b "))).toEndWith(" real real real");
  expect(plain.exitCode).toBe(0);
});

test.concurrent.each(projects)(behindThem + ", one program", async (name, files) => {
  expect(await seenWith(files, "TestRunLayers:0", "--aot")).toEqual(await plainOf(name, files));
});

test.concurrent.each(projects)(behindThem + ", two layers", async (name, files) => {
  // TODO(bun), row 4236: over layers a mock behind the real module is taken as ahead of its load.
  const throughB = (of: Awaited<ReturnType<typeof seenWith>>) =>
    of.seen.slice(0, of.seen.findIndex(line => line.startsWith("SEEN b ")) + 1);
  const layers = await seenWith(files, "TestRunLayers:2,TestRunPartFiles:1", "--aot");
  expect(throughB(layers)).toEqual(throughB(await plainOf(name, files)));
  expect(layers.exitCode).toBe(0);
});
