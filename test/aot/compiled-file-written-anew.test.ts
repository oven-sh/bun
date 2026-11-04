import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// The files are there when the run is built, so they are compiled. `bun test` reads a file when something first loads it, so it runs what a test has left there by then.
const compiled = {
  "late.ts": "export const value = 'as it was compiled';\n",
  "late.cjs": "exports.value = 'as it was compiled';\n",
  "late.json": '{"value":"as it was compiled"}\n',
  "other.json": '{"value":"as it was compiled"}\n',
  "above.ts": 'import { value } from "./late.ts";\nexport const seen = "above sees: " + value;\n',
  "above.cjs": 'exports.seen = "above sees: " + require("./late.cjs").value;\n',
  "beside.ts": "export const value = 'as it was compiled';\n",
  "names.txt": '["/late.ts", "/late.cjs", "/late.json"]\n',
};

const head = `import { test } from "bun:test";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
const here = import.meta.dir;
const say = async (label: string, load: () => unknown) => {
  try { console.log("SAID", label, await load()); }
  catch (error: any) { console.log("SAID", label, "THROWS", error.constructor.name, /written after this test run was compiled/.test(error.message) ? "for the write" : ""); }
};
`;

const cases: Record<string, string> = {
  "written anew before its first load": `
  writeFileSync(here + "/late.ts", "export const value = 'written by the test';\\n");
  await say("import()", async () => (await import("./late.ts")).value);
  writeFileSync(here + "/late.cjs", "exports.value = 'written by the test';\\n");
  await say("require()", () => require("./late.cjs").value);`,
  "of data written anew before its first load": `
  writeFileSync(here + "/late.json", '{"value":"written by the test"}\\n');
  await say("require()", () => require("./late.json").value);
  writeFileSync(here + "/other.json", '{"value":"written by the test"}\\n');
  await say("import()", async () => (await import("./other.json")).default.value);`,
  "written anew below the import of another file": `
  writeFileSync(here + "/late.ts", "export const value = 'written by the test';\\n");
  await say("import()", async () => (await import("./above.ts")).seen);
  await say("beside", async () => (await import("./beside.ts")).value);
  writeFileSync(here + "/late.cjs", "exports.value = 'written by the test';\\n");
  await say("require()", () => require("./above.cjs").seen);`,
  "deleted before its first load": `
  unlinkSync(here + "/late.ts");
  await say("import()", async () => (await import("./late.ts")).value);
  unlinkSync(here + "/late.cjs");
  await say("require()", () => require("./late.cjs").value);`,
  "written anew after its first load": `
  await say("import()", async () => (await import("./late.ts")).value);
  await say("require()", () => require("./late.cjs").value);
  writeFileSync(here + "/late.ts", "export const value = 'written by the test';\\n");
  writeFileSync(here + "/late.cjs", "exports.value = 'written by the test';\\n");
  await say("import() again", async () => (await import("./late.ts")).value);
  await say("require() again", () => require("./late.cjs").value);`,
  "written with the same bytes": `
  writeFileSync(here + "/late.ts", "export const value = 'as it was compiled';\\n");
  await say("import()", async () => (await import("./late.ts")).value);
  writeFileSync(here + "/late.cjs", "exports.value = 'as it was compiled';\\n");
  await say("require()", () => require("./late.cjs").value);`,
};

async function said(flags: string[], body: string) {
  // A run leaves what it has written, so each gets a folder of its own.
  using dir = tempDir("aot-compiled-file-written-anew", {
    ...compiled,
    "tsconfig.json": "{}",
    "a.test.ts": `${head}test("a", async () => {${body}\n});\n`,
  });
  const directory = String(dir);
  const ran = await run([bunExe(), "test", ...flags, "./a.test.ts"], directory, { ...bunEnv, BUN_TMPDIR: directory });
  return {
    lines: (ran.stdout + "\n" + ran.stderr).split("\n").filter(line => line.startsWith("SAID")),
    summary: ran.stderr.split("\n").filter(line => /^ *\d+ (pass|fail)$/.test(line)),
  };
}

// The path of the write comes out of data, so the build reads nothing of it and compiles the run against the text that lies there. To run that text would be a wrong answer that no test sees.
test.concurrent("a compiled file written anew by a path that the build cannot read fails its load", async () => {
  const body = `
  const names: string[] = JSON.parse(readFileSync(here + "/names.txt", "utf8"));
  writeFileSync(process.cwd() + names[0], "export const value = 'written by the test';\\n");
  writeFileSync(process.cwd() + names[1], "exports.value = 'written by the test';\\n");
  writeFileSync(process.cwd() + names[2], '{"value":"written by the test"}\\n');
  await say("import()", async () => (await import("./late.ts")).value);
  await say("require()", () => require("./late.cjs").value);
  await say("below an import", async () => (await import("./above.ts")).seen);
  await say("data", () => require("./late.json").value);
  await say("beside", async () => (await import("./beside.ts")).value);`;
  expect((await said([], body)).lines).toEqual([
    "SAID import() written by the test",
    "SAID require() written by the test",
    "SAID below an import above sees: written by the test",
    "SAID data written by the test",
    "SAID beside as it was compiled",
  ]);
  expect((await said(["--aot"], body)).lines).toEqual([
    "SAID import() THROWS Error for the write",
    "SAID require() THROWS Error for the write",
    "SAID below an import THROWS Error for the write",
    "SAID data written by the test",
    "SAID beside as it was compiled",
  ]);
});

for (const [name, body] of Object.entries(cases)) {
  test.concurrent(`a compiled file ${name}`, async () => {
    const plain = await said([], body);
    expect(plain.lines.length).toBeGreaterThan(1);
    expect(await said(["--aot"], body)).toEqual(plain);
  });
}
