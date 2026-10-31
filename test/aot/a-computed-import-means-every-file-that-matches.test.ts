import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// import(`specs/build/${name}.js`) may mean any file of that folder, so the build compiles them all, however many they are. There was a limit of 1,024: past it
// the build compiled none of them and said nothing: the import threw in an executable, and in a test run the file ran from its text, in the interpreter.
const count = 1100;
const files: Record<string, string> = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": `{}`,
  "node_modules/specs/package.json": `{ "name": "specs", "type": "module" }`,
  "src/registry.js": `export const load = async name => (await import(\`specs/build/\${name}.js\`)).default;
export const loadFew = async name => (await import(\`../few/\${name}.js\`)).default;
`,
  "few/a.js": `export default "few a";\n`,
  "few/b.js": `export default "few b";\n`,
  "main.js": `import { load, loadFew } from "./src/registry.js";
for (const name of ["f1", "f${count}", "deep/f7"]) console.log("SEEN " + name + " | " + (await load(name)));
console.log("SEEN few | " + (await loadFew("b")));
`,
  "loads-the-last.test.js": `import { expect, test } from "bun:test";
import { load } from "./src/registry.js";
test("the file runs as it was compiled", async () => {
  console.log("SEEN f${count} | " + (await load("f${count}")));
  expect(1).toBe(1);
});
`,
  "other.test.js": `import { expect, test } from "bun:test";\ntest("another file", () => { expect(1).toBe(1); });\n`,
};
for (let n = 1; n <= count; n++) files[`node_modules/specs/build/f${n}.js`] = `export default "compiled f${n}";\n`;
for (let n = 1; n <= 10; n++)
  files[`node_modules/specs/build/deep/f${n}.js`] = `export default "compiled deep f${n}";\n`;

const seenIn = (stdout: string) => stdout.split("\n").filter(line => line.startsWith("SEEN "));

test("an executable holds every file that a computed import may mean, and its report counts them", async () => {
  using dir = tempDir("aot-computed-import-of-many-files", files);
  const executable = join(String(dir), isWindows ? "main.exe" : "main");
  const report = join(String(dir), "report.json");
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "--aot-report=" + report, "--outfile", executable, "main.js"],
    String(dir),
    bunEnv,
  );
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const counted = JSON.parse(readFileSync(report, "utf8")).computedImports;
  expect(
    counted.map((it: any) => [it.location.file.replaceAll("\\", "/").split("/").pop(), it.location.line, it.files]),
  ).toEqual([
    ["registry.js", 1, count + 10],
    ["registry.js", 2, 2],
  ]);
  expect(counted[0].bytes).toBeGreaterThan(counted[1].bytes);
  renameSync(join(String(dir), "node_modules"), join(String(dir), "moved-away"));
  renameSync(join(String(dir), "few"), join(String(dir), "few-moved-away"));
  const ran = await run([executable], String(dir), bunEnv);
  expect(seenIn(ran.stdout)).toEqual([
    "SEEN f1 | compiled f1",
    `SEEN f${count} | compiled f${count}`,
    "SEEN deep/f7 | compiled deep f7",
    "SEEN few | few b",
  ]);
}, 120_000);

for (const words of ["TestRunLayers:0", "TestRunLayers:2,TestRunPartFiles:1"]) {
  test(`a test run runs such a file compiled (${words})`, async () => {
    using dir = tempDir("aot-computed-import-of-many-files", files);
    // A file that runs from its text trips the wire. A file that the run itself writes anew is read from disk, as in plain Bun, so writing over it tells nothing.
    const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_JSC_crashIfInterpreterIsUsed: "1" };
    const ran = await run([bunExe(), "test", "--aot", "--isolate"], String(dir), env);
    expect({ seen: seenIn(ran.stdout), exitCode: ran.exitCode }).toEqual({
      seen: [`SEEN f${count} | compiled f${count}`],
      exitCode: 0,
    });
  }, 120_000);
}
