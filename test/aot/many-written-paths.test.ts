// A table of locales, routes or plug-ins spells out the path of each file, and a loop loads them. The build follows every
// text that the program writes, however many there are: a list has as many values as it has entries. The executable runs
// in an empty folder with its sources gone, and prints what plain Bun printed.
//
// Texts that are made of parts may be many more than the file writes: a part added in each of 24 branches makes 16 million.
// Those are paid for like the expressions that the build follows, so such a build gives up on the name and ends.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const upTo = (count: number) => Array.from({ length: count }, (_, index) => index);
const paths = (count: number) => upTo(count).map(index => `"./m${index}.mjs"`);
const forms: Record<string, (count: number) => string> = {
  "a loop over a list": count =>
    `const list = [${paths(count)}];\nlet sum = 0;\nfor (const path of list) sum += (await import(path)).v;\nconsole.log(sum);\n`,
  "a list mapped": count =>
    `const list = [${paths(count)}];\nconst all = await Promise.all(list.map(path => import(path)));\nconsole.log(all.reduce((sum, it) => sum + it.v, 0));\n`,
  "the values of a table": count =>
    `const table = { ${upTo(count).map(index => `k${index}: "./m${index}.mjs"`)} };\nlet sum = 0;\nfor (const path of Object.values(table)) sum += (await import(path)).v;\nconsole.log(sum);\n`,
  "a table under a key": count =>
    `const table = { ${upTo(count).map(index => `k${index}: "./m${index}.mjs"`)} };\nconst n = process.argv.length + ${count - 3};\nconsole.log((await import(table["k" + n])).v);\n`,
  "a list under an index": count =>
    `const list = [${paths(count)}];\nconst n = process.argv.length + ${count - 3};\nconsole.log((await import(list[n])).v);\n`,
  "a function that returns them": count =>
    `function path(n) {\n  switch (n) {\n${upTo(count)
      .map(index => `    case ${index}: return "./m${index}.mjs";\n`)
      .join("")}  }\n}\nconsole.log((await import(path(process.argv.length + ${count - 3}))).v);\n`,
  "stems between two parts": count =>
    `const stems = [${upTo(count).map(index => `"m${index}"`)}];\nlet sum = 0;\nfor (const stem of stems) sum += (await import("./" + stem + ".mjs")).v;\nconsole.log(sum);\n`,
};
const cases = Object.keys(forms).flatMap(form => [65, 300].map(count => [form, count] as const));

test.each(cases)("every written path is in the executable: %s, %d", async (form, count) => {
  using dir = tempDir("many-written-paths", {
    "app/main.mjs": forms[form](count),
    ...Object.fromEntries(upTo(count).map(index => [`app/m${index}.mjs`, `export const v = ${index};\n`])),
    "away/empty.txt": "",
  });
  const app = join(String(dir), "app");
  const away = join(String(dir), "away");
  const executable = join(away, isWindows ? "main.exe" : "main");
  const plain = await run([bunExe(), "main.mjs"], app, bunEnv);
  expect(plain.exitCode).toBe(0);
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable], app, bunEnv);
  expect({ exitCode: built.exitCode, stderr: built.exitCode ? built.stderr : "" }).toEqual({ exitCode: 0, stderr: "" });
  rmSync(app, { recursive: true });
  expect((await run([executable], away, bunEnv)).stdout).toBe(plain.stdout);
});

const withBranches = (count: number) =>
  `let name = "./m";\n${upTo(count)
    .map(index => `if (process.argv.length > ${index + 2}) name += "${String.fromCharCode(97 + index)}";\n`)
    .join("")}console.log((await import(name + ".mjs")).v);\n`;

test("a name with a part added in each of 10 branches is one of 1024 texts", async () => {
  using dir = tempDir("many-written-paths", {
    "app/main.mjs": withBranches(10),
    "app/m.mjs": `export const v = "found";\n`,
    "away/empty.txt": "",
  });
  const app = join(String(dir), "app");
  const away = join(String(dir), "away");
  const executable = join(away, isWindows ? "main.exe" : "main");
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable], app, bunEnv);
  expect(built.exitCode).toBe(0);
  rmSync(app, { recursive: true });
  expect((await run([executable], away, bunEnv)).stdout).toBe("found\n");
});

test("a name with a part added in each of 24 branches does not hold the build up", async () => {
  using dir = tempDir("many-written-paths", { "main.mjs": withBranches(24), "m.mjs": `export const v = "found";\n` });
  const executable = join(String(dir), isWindows ? "main.exe" : "main");
  const started = performance.now();
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable],
    String(dir),
    bunEnv,
  );
  expect(built.exitCode).toBe(0);
  expect(performance.now() - started).toBeLessThan(60_000);
});
