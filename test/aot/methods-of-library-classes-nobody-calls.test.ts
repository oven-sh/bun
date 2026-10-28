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

test("a symbol that the program writes is found where the key may also be something that nobody knows", async () => {
  using dir = tempDir("aot-method-under-a-written-symbol-or-another-key", {
    "lines.txt": "one\ntwo\nthree\n",
    "written-beside-another-key.mjs": `import { open } from "node:fs/promises";
globalThis.kept = await open("lines.txt");
const handle = Reflect.get(globalThis, "kept");
const named = key => Reflect.get(globalThis, "a key that nobody has set") ?? key;
await handle[named(Symbol.asyncDispose)]();
console.log(handle.fd);
`,
  });
  await expectSameAsBunRun(String(dir), "written-beside-another-key.mjs");
});

test("whoever lists the own keys of the prototype object of a library class calls its methods under them", async () => {
  const statement = `import { Database } from "bun:sqlite";
const it = new Database(":memory:").query("select 1 as a");
`;
  const calls = (above: string, keys: string, call = "it[key]()") => `${statement}const above = ${above};
for (const key of ${keys}) {
  if (key === "constructor" || typeof Reflect.getOwnPropertyDescriptor(above, key).value !== "function") continue;
  try {
    ${call};
    console.log(String(key), "ran");
  } catch (error) {
    console.log(String(key), error.name);
  }
}
`;
  using dir = tempDir("aot-own-keys-of-prototype-objects-of-library-classes", {
    "every-key.mjs": calls("Object.getPrototypeOf(it)", "Reflect.ownKeys(above)"),
    "names.mjs": calls("Reflect.getPrototypeOf(it)", "Object.getOwnPropertyNames(above)"),
    "symbols.mjs": calls("Object.getPrototypeOf(it)", "Object.getOwnPropertySymbols(above)"),
    "descriptors.mjs": calls("Object.getPrototypeOf(it)", "Object.keys(Object.getOwnPropertyDescriptors(above))"),
    "by-the-accessor.mjs": calls("it.__proto__", "Reflect.ownKeys(above)"),
    "on-an-heir.mjs": calls("Object.getPrototypeOf(it)", "Reflect.ownKeys(above)", "Object.create(it)[key]()"),
    "off-the-prototype-object.mjs": calls(
      "Object.getPrototypeOf(it)",
      "Reflect.ownKeys(above)",
      "Reflect.apply(above[key], it, [])",
    ),
    "bound-under-other-names.mjs": `${statement}const above = Object.getPrototypeOf(it);
const bound = {};
for (const key of Object.getOwnPropertyNames(above))
  if (key !== "constructor" && typeof Object.getOwnPropertyDescriptor(above, key).value === "function") bound[key + "Later"] = it[key].bind(it);
for (const key of Object.keys(bound)) console.log(key, typeof bound[key]());
`,
    "every-level.mjs": `import { Session } from "node:inspector";
class Mine extends Session {
  own() {}
}
const box = JSON.parse("{}");
box.it = new Mine();
for (let level = Object.getPrototypeOf(box.it); level !== Object.prototype; level = Object.getPrototypeOf(level)) {
  for (const key of Reflect.ownKeys(level)) {
    if (!["own", "connect", "connectToMainThread", "disconnect"].includes(key)) continue;
    try {
      box.it[key]();
      console.log(key, "ran");
    } catch (error) {
      console.log(key, error.name);
    }
  }
}
`,
  });
  const directory = String(dir);
  for (const entry of [
    "every-key.mjs",
    "names.mjs",
    "symbols.mjs",
    "descriptors.mjs",
    "by-the-accessor.mjs",
    "on-an-heir.mjs",
    "off-the-prototype-object.mjs",
    "bound-under-other-names.mjs",
    "every-level.mjs",
  ])
    await expectSameAsBunRun(directory, entry);
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
