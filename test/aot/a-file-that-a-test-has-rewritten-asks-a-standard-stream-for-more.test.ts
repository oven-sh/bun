// A test writes a file of the project anew, takes it out of require.cache and requires it again: the text that is on disk now is code that nobody has read, and it runs from that text.
// It asks process.stdout for a member that nothing in the build asks for. The function that makes the whole stream was left out, and for such code the library runs from its text.
// Native code makes the small stream where the function was left out AND all that runs beside the image are copies of its files
// (a-test-that-requires-a-file-writes-to-a-standard-stream.test.ts). It asked the first half alone: "TypeError: This standard stream was made without its other members".
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const rewritten = `
  const E = require("node:events");
  exports.a = [process.stdout.listenerCount("drain"), typeof process.stdout.cork, typeof process.stderr.once, process.stdout instanceof E].join();
`;
const ways = {
  "by a stream": `await new Promise(done => fs.createWriteStream(path).end(NEW, done));`,
  "by a promise": `await fs.promises.writeFile(path, NEW);`,
};

async function linesOf(way: string, flags: string[], words?: string) {
  using dir = tempDir("aot-rewritten-file-and-streams", {
    "m.cjs": `exports.a = "first";\n`,
    "a.test.mjs": `
      import { test } from "bun:test";
      import fs from "node:fs";
      const NEW = ${JSON.stringify(rewritten)};
      test("t", async () => {
        const path = require.resolve("./m.cjs");
        console.error("OUT", require("./m.cjs").a);
        ${way}
        delete require.cache[path];
        console.error("OUT", require("./m.cjs").a);
      });`,
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
  async (_, way) => {
    const plain = await linesOf(way, []);
    expect(plain).toEqual({ lines: ["OUT first", "OUT 0,function,function,true"], exitCode: 0 });
    expect(await linesOf(way, ["--aot"])).toEqual(plain);
    expect(await linesOf(way, ["--aot"], "TestRunLayers:2")).toEqual(plain);
  },
  240_000,
);
