import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { posix } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// `bun test` reads a file when something first loads it. A test writes state.js anew and imports it afterwards, for the first time in the
// run: it gets the new text. Nothing is taken out of require.cache here. The build sees the call that writes, with the path that it spells.
//
// Every case is a folder of one project, which runs once for each way of running it, each time from files as they were.
const first = `export let count = 0;\nexport function bump() { return ++count; }\n`;
const next = `export let count = 100;\nexport function bump() { return count += 10; }\nexport const extra = "new";\n`;
const text = JSON.stringify(next);
const own = `join(import.meta.dir, "state.js")`;

const head = (id: string) => `
import { test } from "bun:test";
import fs, { appendFileSync, closeSync, copyFileSync, openSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const say = (...all) => console.log("${id}|", ...all);
`;
const look = `const state = await import("./state.js"); say(state.count, state.bump(), Object.keys(state).sort().join());`;

type Case = { files: (id: string) => Record<string, string>; prints: string[] };
const written = (change: (id: string) => string): Case => ({
  files: id => ({
    "state.js": first,
    "case.test.js": `${head(id)}test("${id}", async () => { ${change(id)}; ${look} });`,
  }),
  prints: ["100 110 bump,count,extra"],
});

const cases: Record<string, Case> = {
  "writeFileSync, a path joined to the folder of the test file": written(() => `writeFileSync(${own}, ${text})`),
  "a path kept in a const": written(() => `const path = ${own}; writeFileSync(path, ${text})`),
  "a path in a template": written(() => "writeFileSync(`${import.meta.dirname}/state.js`, " + text + ")"),
  "a URL beside the test file": written(() => `writeFileSync(new URL("./state.js", import.meta.url), ${text})`),
  "what require.resolve() answers": written(() => `writeFileSync(require.resolve("./state.js"), ${text})`),
  "a path made by resolve()": written(() => `writeFileSync(resolve(import.meta.dir, "state.js"), ${text})`),
  "the path of a URL": written(() => `writeFileSync(fileURLToPath(new URL("./state.js", import.meta.url)), ${text})`),
  "what import.meta.resolve() answers": written(
    () => `writeFileSync(fileURLToPath(import.meta.resolve("./state.js")), ${text})`,
  ),
  "a path kept in an object": written(() => `const paths = { state: ${own} }; writeFileSync(paths.state, ${text})`),
  "one of two names": written(
    () =>
      `const name = process.argv.length > 99 ? "other" : "state"; writeFileSync(join(import.meta.dir, name + ".js"), ${text})`,
  ),
  "a function of the test file that takes the name": written(
    () => `const put = (name, text) => writeFileSync(join(import.meta.dir, name), text); put("state.js", ${text})`,
  ),
  "a path from the working directory": written(id => `writeFileSync("${id}/state.js", ${text})`),
  "a function read off the module": written(() => `fs.writeFileSync(${own}, ${text})`),
  "a function under another name": written(() => `const put = fs.writeFileSync; put(${own}, ${text})`),
  "fs.promises.writeFile": written(() => `await fs.promises.writeFile(${own}, ${text})`),
  "writeFile of node:fs/promises": written(() => `await writeFile(${own}, ${text})`),
  "Bun.write": written(() => `await Bun.write(${own}, ${text})`),
  "Bun.write to a file object": written(() => `await Bun.write(Bun.file(${own}), ${text})`),
  "the write() of a file object": written(() => `const file = Bun.file(${own}); await file.write(${text})`),
  "another file moved there": written(
    () =>
      `writeFileSync(join(import.meta.dir, "next.txt"), ${text}); renameSync(join(import.meta.dir, "next.txt"), ${own})`,
  ),
  "another file copied there": written(
    () =>
      `writeFileSync(join(import.meta.dir, "next.txt"), ${text}); copyFileSync(join(import.meta.dir, "next.txt"), ${own})`,
  ),
  "opened for writing": written(() => `const fd = openSync(${own}, "w"); writeSync(fd, ${text}); closeSync(fd)`),
  "one of the names of a list": written(
    () => `for (const name of ["state.js", "other.txt"]) writeFileSync(join(import.meta.dir, name), ${text})`,
  ),
  "a line more at its end": {
    files: id => ({
      "state.js": first,
      "case.test.js": `${head(id)}test("${id}", async () => { appendFileSync(${own}, "export const extra = 1;"); ${look} });`,
    }),
    prints: ["0 1 bump,count,extra"],
  },
  "the file is removed": {
    files: id => ({
      "state.js": first,
      "case.test.js": `${head(id)}test("${id}", async () => {
        rmSync(${own});
        say(await import("./state.js").then(() => "loaded", error => error.constructor.name + ": " + error.message));
      });`,
    }),
    prints: [expect.stringContaining("ENOENT reading") as unknown as string],
  },
  "the folder of the file is removed": {
    files: id => ({
      "made/state.js": first,
      "case.test.js": `${head(id)}test("${id}", async () => {
        rmSync(join(import.meta.dir, "made"), { recursive: true });
        say(await import("./made/state.js").then(() => "loaded", () => "not loaded"));
      });`,
    }),
    prints: ["not loaded"],
  },
  "a module that has not run yet imports the file": {
    files: id => ({
      "state.js": first,
      "helper.js": `import { bump, count } from "./state.js"; export const seen = () => [count, bump(), count].join();`,
      "case.test.js": `${head(id)}test("${id}", async () => { writeFileSync(${own}, ${text}); say((await import("./helper.js")).seen()); });`,
    }),
    prints: ["100,110,110"],
  },
  // The compiled lib.js has run by then. The new text links to it, by a name that no compiled file reads, and calls it with a text where compiled code passes numbers.
  "the new text imports a compiled file": {
    files: id => ({
      "lib.js": `let calls = 0;\nexport function twice(value) { calls++; return value + value; }\nexport const unread = () => "calls " + calls;\n`,
      "state.js": `import { twice } from "./lib.js";\nexport const made = twice(1);\n`,
      "case.test.js": `${head(id)}import { twice } from "./lib.js";
        test("${id}", async () => {
          say(twice(2));
          writeFileSync(${own}, 'import { twice, unread } from "./lib.js";\\nexport const made = [twice("ab"), unread()].join();\\n');
          say((await import("./state.js")).made);
        });`,
    }),
    prints: ["4", "abab,calls 2"],
  },
  "a CommonJS file": {
    files: id => ({
      "state.cjs": `exports.count = 0;\n`,
      "case.test.js": `${head(id)}test("${id}", () => {
        writeFileSync(join(import.meta.dir, "state.cjs"), "exports.count = 100; exports.extra = 1;");
        say(JSON.stringify(require("./state.cjs")));
      });`,
    }),
    prints: [`{"count":100,"extra":1}`],
  },
  "a file of data that is imported": {
    files: id => ({
      "state.json": `{ "count": 0 }`,
      "case.test.js": `${head(id)}test("${id}", async () => {
        writeFileSync(join(import.meta.dir, "state.json"), '{ "count": 100, "extra": 1 }');
        say(JSON.stringify((await import("./state.json")).default));
      });`,
    }),
    prints: [`{"count":100,"extra":1}`],
  },
  "a file of data that is required": {
    files: id => ({
      "state.json": `{ "count": 0 }`,
      "case.test.js": `${head(id)}test("${id}", () => {
        writeFileSync(join(import.meta.dir, "state.json"), '{ "count": 100, "extra": 1 }');
        say(JSON.stringify(require("./state.json")));
      });`,
    }),
    prints: [`{"count":100,"extra":1}`],
  },
  "a helper writes, and the test file imports": {
    files: id => ({
      "state.js": first,
      "writer.js": `import { writeFileSync } from "node:fs";\nexport const write = text => writeFileSync(import.meta.dir + "/state.js", text);\n`,
      "case.test.js": `${head(id)}import { write } from "./writer.js";\ntest("${id}", async () => { write(${text}); ${look} });`,
    }),
    prints: ["100 110 bump,count,extra"],
  },
  "written before the tests begin": {
    files: id => ({
      "state.js": first,
      "case.test.js": `${head(id)}import { beforeAll } from "bun:test";
        const path = ${own};
        beforeAll(() => { writeFileSync(path, ${text}); });
        test("${id}", async () => { ${look} });`,
    }),
    prints: ["100 110 bump,count,extra"],
  },
  // `bun test` takes the folders of the project by name and the files of a folder as the disk lists them, so the later file has a later folder.
  "a later test file imports the file by a statement": {
    files: id => ({
      "state.js": first,
      "case-a.test.js": `${head(id)}test("${id} a", () => { writeFileSync(${own}, ${text}); say("written"); });`,
      "../later-than-all/case-b.test.js": `${head(id)}import * as state from "../${id}/state.js";
        test("${id} b", () => { say(state.count, state.bump(), Object.keys(state).sort().join()); });`,
    }),
    prints: ["written", "100 110 bump,count,extra"],
  },
  // The call never runs: the file on disk is the file that was compiled.
  "the file stays as it is": {
    files: id => ({
      "state.js": first,
      "case.test.js": `${head(id)}test("${id}", async () => { if (process.argv.length > 99) writeFileSync(${own}, ${text}); ${look} });`,
    }),
    prints: ["0 1 bump,count"],
  },
};

const ids = new Map(Object.keys(cases).map((name, index) => [name, `c${String(index + 1).padStart(2, "0")}`]));
const project: Record<string, string> = { "package.json": `{ "name": "p", "type": "module" }` };
for (const [name, { files }] of Object.entries(cases)) {
  const id = ids.get(name)!;
  for (const [path, content] of Object.entries(files(id))) project[posix.join(id, path)] = content;
}

const runs = new Map<string, Promise<Map<string, string[]>>>();
function ran(flags: string[], words = "") {
  return runs.getOrInsertComputed(JSON.stringify([flags, words]), async () => {
    using dir = tempDir("a-test-writes-a-source-file", project);
    const folder = String(dir);
    const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], folder, env);
    if (exitCode !== 0) console.error(stderr);
    const printed = new Map<string, string[]>();
    for (const [, id, line] of stdout.replaceAll(folder, ".").matchAll(/^(c\d+)\| (.*)$/gm))
      printed.getOrInsertComputed(id, () => []).push(line);
    return printed;
  });
}

const ways: [string[], string][] = [
  [[], ""],
  [["--isolate"], "TestRunLayers:0"],
  [["--isolate"], "TestRunLayers:2,TestRunPartFiles:1"],
];

for (const [flags, words] of ways) {
  test.each(Object.keys(cases))(
    `%s: ${JSON.stringify(flags)} ${words}`,
    async name => {
      const id = ids.get(name)!;
      const plain = (await ran(flags)).get(id);
      expect(plain).toEqual(cases[name].prints);
      expect((await ran(["--aot", ...flags], words)).get(id)).toEqual(plain);
    },
    480_000,
  );
}
