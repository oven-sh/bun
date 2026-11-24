import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A compiled file whose entry was taken out of the cache is loaded a second time from its text, and the loader holds what it made of that text.
// It imports a compiled file, which the loader does not hold. The next test file lays a mock over that one.
const projectOf = (between: string, counts = true) => ({
  "package.json": `{ "name": "made-up", "private": true }\n`,
  "spring.mjs": `export const pull = "spring";\n`,
  "gauge.mjs": `import { pull } from "./spring.mjs";\nglobalThis.turns = (globalThis.turns ?? 0) + 1;\nexport const read = () => pull;\n`,
  "a.test.mjs": `import { test, vi } from "bun:test";
import { createRequire } from "node:module";
const ask = createRequire(import.meta.url);
test("a", async () => {
  await import("./gauge.mjs");
  const key = ask.resolve("./gauge.mjs");
${between}  console.log("SAID A", (await import("./gauge.mjs")).read()${counts ? ", globalThis.turns" : ""});
});
`,
  "b.test.mjs": `import { test, vi } from "bun:test";
test("b", async () => {
  vi.doMock("./spring.mjs", () => ({ pull: "mock" }));
  const under = (await import("./gauge.mjs")).read();
  vi.doUnmock("./spring.mjs");
  const behind = (await import("./gauge.mjs")).read();
  console.log("SAID B", under, behind${counts ? ", globalThis.turns" : ""});
});
`,
});

async function linesOf(project: Record<string, string>, ...flags: string[]) {
  using dir = tempDir("aot-a-mock-below-a-file-held-as-text", project);
  const { stdout } = await run([bunExe(), "test", ...flags], String(dir), { ...bunEnv, NO_COLOR: "1" });
  return stdout.split("\n").filter(line => line.startsWith("SAID"));
}

const entry = `{ id: key, filename: key, loaded: true, exports: { read: () => "entry" } }`;

test("the entry of the file is deleted", async () => {
  const project = projectOf(`  delete ask.cache[key];\n`);
  const plain = await linesOf(project);
  expect(plain).toEqual(["SAID A spring 2", "SAID B mock spring 4"]);
  expect(await linesOf(project, "--aot")).toEqual(plain);
});

test("an entry is stored under its key and deleted", async () => {
  const project = projectOf(`  ask.cache[key] = ${entry};\n  delete ask.cache[key];\n`);
  const plain = await linesOf(project);
  expect(plain).toEqual(["SAID A spring 2", "SAID B mock spring 4"]);
  expect(await linesOf(project, "--aot")).toEqual(plain);
});

test("the same under a mock over the file, which then ends", async () => {
  const project = projectOf(
    `  vi.doMock("./gauge.mjs", () => ({ read: () => "over" }));\n  ask.cache[key] = ${entry};\n  delete ask.cache[key];\n  vi.doUnmock("./gauge.mjs");\n`,
    false,
  );
  const plain = await linesOf(project);
  expect(plain).toEqual(["SAID A spring", "SAID B mock spring"]);
  expect(await linesOf(project, "--aot")).toEqual(plain);
});
