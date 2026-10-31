// A method of a class of a built-in module has code in the executable where the program calls it: by its name, or under a
// computed key on an object that the compiler follows. That an object of the class is handed around brings in none of them,
// so a program that prints `console` or uses `process.stdout` holds nothing of `node:readline`.
import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { withReport } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

setDefaultTimeout(240_000);

const leastCodeOfLineEditor = 150_000;

const isOfLineEditor = (file: string) =>
  /^(node:readline|internal:readline\/interface|internal:repl\/history)/.test(file);

async function build(directory: string, entry: string) {
  const executable = join(directory, entry.replace(/\.m?js$/, isWindows ? ".exe" : ""));
  const report = join(directory, entry + ".report.json");
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", ...withReport(report, "functions"), entry, "--outfile", executable],
    directory,
  );
  expect({
    errors: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ errors: [], exitCode: 0 });
  const { summary, functions } = (await Bun.file(report).json()) as {
    summary: { codeBytes: number };
    functions: { file: string | null }[];
  };
  const filesOfLineEditor = [...new Set(functions.map(compiled => compiled.file ?? "").filter(isOfLineEditor))].sort();
  return { executable, codeBytes: summary.codeBytes, filesOfLineEditor };
}

async function expectSameAsBunRun(directory: string, entry: string) {
  const built = await build(directory, entry);
  const interpreted = await run([bunExe(), "run", entry], directory, bunEnv);
  const compiled = await run([built.executable], directory, bunEnv);
  expect(compiled).toEqual(interpreted);
  expect(compiled.exitCode).toBe(0);
  return built;
}

test("printing console or using a standard stream brings in nothing of node:readline", async () => {
  using dir = tempDir("aot-standard-streams", {
    "number.js": `console.error(1);\n`,
    "console.js": `console.error(console);\n`,
    "stream.js": `console.log(process.stdout);\n`,
    "editor.js": `console.error(console, typeof require("node:readline").createInterface);\n`,
  });
  const directory = String(dir);
  const number = await expectSameAsBunRun(directory, "number.js");
  const editor = await expectSameAsBunRun(directory, "editor.js");
  expect(editor.filesOfLineEditor).toContain("node:readline");
  for (const entry of ["console.js", "stream.js"]) {
    const built = await expectSameAsBunRun(directory, entry);
    expect({ entry, files: built.filesOfLineEditor }).toEqual({ entry, files: [] });
    expect(built.codeBytes).toBeGreaterThan(number.codeBytes);
    expect(built.codeBytes).toBeLessThan(editor.codeBytes - leastCodeOfLineEditor);
  }
});

test("listing the own keys of another object brings in no method of a library class", async () => {
  using dir = tempDir("aot-own-keys-of-other-objects", {
    "lines.txt": "one\ntwo\nthree\n",
    "held.mjs": `import { open } from "node:fs/promises";
const box = JSON.parse('{"a":1}');
box.handle = await open("lines.txt");
console.log(typeof box.handle.fd);
await box.handle.close();
`,
    "listed.mjs": `import { open } from "node:fs/promises";
const box = JSON.parse('{"a":1}');
box.handle = await open("lines.txt");
console.log(typeof box.handle.fd, Reflect.ownKeys(box), Object.getOwnPropertyNames(box.handle).length >= 0, Object.getPrototypeOf(box) === Object.prototype);
await box.handle.close();
`,
  });
  const directory = String(dir);
  const held = await expectSameAsBunRun(directory, "held.mjs");
  const listed = await expectSameAsBunRun(directory, "listed.mjs");
  expect({ held: held.filesOfLineEditor, listed: listed.filesOfLineEditor }).toEqual({ held: [], listed: [] });
});
