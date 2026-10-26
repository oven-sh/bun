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

const plainStream = `const stream = { write(text, done) { console.log(JSON.stringify(text), typeof done); return true; } };\n`;

test("printing console or using a standard stream brings in nothing of node:readline", async () => {
  using dir = tempDir("aot-standard-streams", {
    "number.js": `console.error(1);\n`,
    "console.js": `console.error(console);\n`,
    "inspected.js": `console.log(Bun.inspect(console));\n`,
    "stream.js": `console.log(process.stdout);\n`,
    "written.js": `const c = console;\nc._stdout.write("x");\n`,
    "editor.js": `console.error(console, typeof require("node:readline").createInterface);\n`,
  });
  const directory = String(dir);
  const number = await expectSameAsBunRun(directory, "number.js");
  const editor = await expectSameAsBunRun(directory, "editor.js");
  expect(editor.filesOfLineEditor).toContain("node:readline");
  for (const entry of ["console.js", "inspected.js", "stream.js", "written.js"]) {
    const built = await expectSameAsBunRun(directory, entry);
    expect({ entry, files: built.filesOfLineEditor }).toEqual({ entry, files: [] });
    expect(built.codeBytes).toBeGreaterThan(number.codeBytes);
    expect(built.codeBytes).toBeLessThan(editor.codeBytes - leastCodeOfLineEditor);
  }
});

test("the cursor methods of tty.WriteStream run what node:readline exports at that moment", async () => {
  using dir = tempDir("aot-cursor-methods", {
    "called.js": `const methods = require("node:tty").WriteStream.prototype;
${plainStream}console.log(methods.clearLine.call(stream, 0), methods.cursorTo.call(stream, 1, 2));
console.log(methods.moveCursor.call(stream, 1, -1), methods.clearScreenDown.call(stream));
`,
    "replaced.js": `const methods = require("node:tty").WriteStream.prototype;
${plainStream}console.log(methods.clearLine.call(stream, 0));
const readline = require("node:readline");
readline.clearLine = (given, direction) => "replaced " + direction + " " + (given === stream);
console.log(methods.clearLine.call(stream, 1), methods.cursorTo.call(stream, 3));
`,
    "listed.js": `const methods = require("node:tty").WriteStream.prototype;
${plainStream}for (const key of Object.keys(methods).filter(key => key.startsWith("clear")).sort()) console.log(key, methods[key].call(stream));
`,
  });
  const directory = String(dir);
  expect((await expectSameAsBunRun(directory, "called.js")).filesOfLineEditor).toEqual([]);
  expect((await expectSameAsBunRun(directory, "listed.js")).filesOfLineEditor).toEqual([]);
  expect((await expectSameAsBunRun(directory, "replaced.js")).filesOfLineEditor).toContain("node:readline");
});

test("a method of a library class is found by its name and under a key on an object that is followed", async () => {
  const counts = (call: string) => `let count = 0;\nfor await (const line of ${call}) count++;\nconsole.log(count);\n`;
  using dir = tempDir("aot-methods-of-library-classes", {
    "lines.txt": "one\ntwo\nthree\n",
    "named.mjs": `import { open } from "node:fs/promises";
const handle = await open("lines.txt");
${counts("handle.readLines()")}`,
    "keyed.mjs": `import { open } from "node:fs/promises";
const handle = await open("lines.txt");
${counts(`handle[JSON.parse('"readLines"')]()`)}`,
    "named-on-parsed.mjs": `import { open } from "node:fs/promises";
const box = JSON.parse("{}");
box.handle = await open("lines.txt");
${counts("box.handle.readLines()")}`,
    "unused.mjs": `import { open } from "node:fs/promises";
const handle = await open("lines.txt");
console.log(typeof handle.readLines, Object.getOwnPropertyNames(Object.getPrototypeOf(handle)).includes("readLines"));
await handle.close();
`,
  });
  const directory = String(dir);
  for (const entry of ["named.mjs", "keyed.mjs", "named-on-parsed.mjs"])
    expect((await expectSameAsBunRun(directory, entry)).filesOfLineEditor).toContain("node:readline");
  await expectSameAsBunRun(directory, "unused.mjs");
});

test("under a computed key on an object that came out of parsed data, the method is read and a call of it says what to do", async () => {
  using dir = tempDir("aot-method-under-key-on-parsed", {
    "lines.txt": "one\ntwo\nthree\n",
    "keyed-on-parsed.mjs": `import { open } from "node:fs/promises";
const box = JSON.parse('{"name":"readLines"}');
box.handle = await open("lines.txt");
console.log(typeof box.handle[box.name], box.handle[box.name].name);
try {
  box.handle[box.name]();
} catch (error) {
  console.log(error.message.split(". ")[0]);
}
await box.handle.close();
`,
  });
  const directory = String(dir);
  const built = await build(directory, "keyed-on-parsed.mjs");
  expect(built.filesOfLineEditor).toEqual([]);
  expect(await run([built.executable], directory, bunEnv)).toEqual({
    stdout: "function readLines\n'readLines' was not compiled into this executable because your code never calls it\n",
    stderr: "",
    exitCode: 0,
  });
});

test("an accessor of a library class runs where the program or the library reads or stores by its name", async () => {
  using dir = tempDir("aot-accessors-of-library-classes", {
    "stored-by-the-library.mjs": `import { SQL } from "bun";
const sql = new SQL("sqlite://:memory:");
const query = sql\`select 1 as x\`;
console.log(query.active, query.cancelled);
console.log(JSON.stringify(await query), query.active);
await sql.close();
`,
    "stored-on-parsed.mjs": `import { MIMEType } from "node:util";
const box = JSON.parse("{}");
box.type = new MIMEType("text/plain;charset=utf-8");
box.type.type = "application";
box.type.subtype = "json";
console.log(box.type.essence, box.type.params.get("charset"));
`,
    "run-by-native-code.mjs": `import { MIMEType } from "node:util";
const box = JSON.parse("{}");
box.type = new MIMEType("text/plain;charset=utf-8");
console.log(JSON.stringify(box), "" + box.type, [...box.type.params]);
`,
  });
  const directory = String(dir);
  for (const entry of ["stored-by-the-library.mjs", "stored-on-parsed.mjs", "run-by-native-code.mjs"])
    await expectSameAsBunRun(directory, entry);
});
