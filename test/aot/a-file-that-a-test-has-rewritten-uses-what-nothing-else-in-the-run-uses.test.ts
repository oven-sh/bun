// A test writes a file of the project anew and loads it again. The text that is on disk now is code that nobody has read: it runs from that text, and it uses members
// of Bun's own modules that nothing else in the run uses. The build knew that the file may change, and still left out of the library what the files it had read do not call:
// "error: 'WriteStream' was not compiled into this executable because your code never calls it", 'ReadStream', 'inspect'.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const rewritten = `
  const ask = f => { try { return String(f()); } catch (error) { return error.constructor.name + ": " + error.message; } };
  exports.a = [
    ask(() => process.stdout.listenerCount("drain")),
    ask(() => typeof process.stdin.on),
    ask(() => require("node:util").inspect({ a: new Map([[1, 2]]) })),
    ask(() => require("node:zlib").gunzipSync(require("node:zlib").gzipSync("zipped"))),
  ].join(" | ");
`;
const answer = "0 | function | { a: Map(1) { 1 => 2 } } | zipped";
const loadsTwice = (write: string) => (says: string) => `
  import { test } from "bun:test";
  import fs from "node:fs";
  import { put } from "./helper.mjs";
  const NEW = ${JSON.stringify(rewritten)};
  test("t", async () => {
    const path = require.resolve("./m.cjs");
    console.error("${says}", require("./m.cjs").a);
    ${write}
    delete require.cache[path];
    console.error("${says}", require("./m.cjs").a);
  });`;
const ways: Record<string, Record<string, (says: string) => string>> = {
  "written in the test": { "a.test.mjs": loadsTwice(`fs.writeFileSync(path, NEW);`) },
  "written by a promise": { "a.test.mjs": loadsTwice(`await fs.promises.writeFile(path, NEW);`) },
  "copied over": { "a.test.mjs": loadsTwice(`fs.copyFileSync(import.meta.dir + "/new.txt", path);`) },
  "moved over": { "a.test.mjs": loadsTwice(`fs.renameSync(import.meta.dir + "/new.txt", path);`) },
  "written by a function of another file": { "a.test.mjs": loadsTwice(`put(NEW);`) },
  "written by one test file and imported by a statement of the next": {
    "a.test.mjs": says => `
      import { test } from "bun:test";
      import fs from "node:fs";
      test("t", () => {
        console.error("${says} first");
        fs.writeFileSync(import.meta.dir + "/m.cjs", ${JSON.stringify(rewritten)});
      });`,
    "b.test.mjs": says => `
      import { test } from "bun:test";
      import m from "./m.cjs";
      test("t", () => console.error("${says}", m.a));`,
  },
};

// Each way in a folder of its own, all of them one project: what a run costs is the library that it holds for the new text, once.
async function linesOf(flags: string[]) {
  const files: Record<string, string> = {};
  for (const [index, testFiles] of Object.values(ways).entries()) {
    files[`w${index}/m.cjs`] = `exports.a = "first";\n`;
    files[`w${index}/new.txt`] = rewritten;
    files[`w${index}/helper.mjs`] =
      `import fs from "node:fs";\nexport const put = text => fs.writeFileSync(import.meta.dir + "/m.cjs", text);\n`;
    for (const [name, text] of Object.entries(testFiles)) files[`w${index}/${name}`] = text(`OUT${index}`);
  }
  using dir = tempDir("aot-rewritten-file-and-the-library", files);
  await using run = Bun.spawn({
    // `bun test` runs the files of a folder as the file system lists them, and shared memory lists the newest first. The last way needs its two in the order of their names.
    cmd: [
      bunExe(),
      "test",
      ...flags,
      "--isolate",
      ...Object.keys(files)
        .filter(name => name.includes(".test."))
        .sort()
        .map(name => "./" + name),
    ],
    cwd: String(dir),
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
  return { lines: stderr.split("\n").filter(line => /^(OUT|error)/.test(line)), exitCode };
}

let runs: Promise<Awaited<ReturnType<typeof linesOf>>[]> | undefined;
test.concurrent.each(Object.keys(ways))(
  "%s",
  async name => {
    const says = `OUT${Object.keys(ways).indexOf(name)} `;
    const [plain, compiled] = (await (runs ??= Promise.all([linesOf([]), linesOf(["--aot"])]))).map(
      ({ lines, exitCode }) => ({
        lines: lines
          .filter(line => line.startsWith(says) || line.startsWith("error"))
          .map(line => line.replace(says, "OUT ")),
        exitCode,
      }),
    );
    expect(plain).toEqual({ lines: ["OUT first", "OUT " + answer], exitCode: 0 });
    expect(compiled).toEqual(plain);
  },
  240_000,
);
