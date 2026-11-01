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
const loadsTwice = (write: string) => `
  import { test } from "bun:test";
  import fs from "node:fs";
  import { put } from "./helper.mjs";
  const NEW = ${JSON.stringify(rewritten)};
  test("t", async () => {
    const path = require.resolve("./m.cjs");
    console.error("OUT", require("./m.cjs").a);
    ${write}
    delete require.cache[path];
    console.error("OUT", require("./m.cjs").a);
  });`;
const ways: Record<string, Record<string, string>> = {
  "written in the test": { "a.test.mjs": loadsTwice(`fs.writeFileSync(path, NEW);`) },
  "written by a promise": { "a.test.mjs": loadsTwice(`await fs.promises.writeFile(path, NEW);`) },
  "copied over": { "a.test.mjs": loadsTwice(`fs.copyFileSync(import.meta.dir + "/new.txt", path);`) },
  "moved over": { "a.test.mjs": loadsTwice(`fs.renameSync(import.meta.dir + "/new.txt", path);`) },
  "written by a function of another file": { "a.test.mjs": loadsTwice(`put(NEW);`) },
  "written by one test file and imported by a statement of the next": {
    "a.test.mjs": `
      import { test } from "bun:test";
      import fs from "node:fs";
      test("t", () => {
        console.error("OUT first");
        fs.writeFileSync(import.meta.dir + "/m.cjs", ${JSON.stringify(rewritten)});
      });`,
    "b.test.mjs": `
      import { test } from "bun:test";
      import m from "./m.cjs";
      test("t", () => console.error("OUT", m.a));`,
  },
};

async function linesOf(files: Record<string, string>, flags: string[], words?: string) {
  using dir = tempDir("aot-rewritten-file-and-the-library", {
    "m.cjs": `exports.a = "first";\n`,
    "new.txt": rewritten,
    "helper.mjs": `import fs from "node:fs";\nexport const put = text => fs.writeFileSync(import.meta.dir + "/m.cjs", text);\n`,
    ...files,
  });
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  await using run = Bun.spawn({
    cmd: [bunExe(), "test", ...flags, "--isolate"],
    cwd: String(dir),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
  return { lines: stderr.split("\n").filter(line => /^(OUT|error)/.test(line)), exitCode };
}

test.concurrent.each(Object.entries(ways))(
  "%s",
  async (_, files) => {
    const plain = await linesOf(files, []);
    expect(plain).toEqual({ lines: ["OUT first", "OUT " + answer], exitCode: 0 });
    expect(await linesOf(files, ["--aot"])).toEqual(plain);
    expect(await linesOf(files, ["--aot"], "TestRunLayers:2")).toEqual(plain);
  },
  240_000,
);
