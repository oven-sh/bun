// `require("./m.cjs"); process.stderr.write("x\n")` in a test file. A file that is required may be taken out of require.cache and read again from disk, so the image of such a test run
// lets the library run from its text. The build had left the function that makes the whole stream out, because the program asks process.stderr for `write` alone. Native code took "its
// text may run" for "it was not left out", made the whole stream from the text, and that text called what else the build had left out:
// "'EventEmitter' was not compiled into this executable because your code never calls it".
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const bodies = {
  "a file is required": `require("./m.cjs"); process.stderr.write("OUT written\\n");`,
  "a name of it is read": `const m = require("./m.cjs"); process.stderr.write("OUT written " + m.a + "\\n");`,
  "the other stream": `const m = require("./m.cjs"); process.stdout.write("to the other stream\\n"); process.stderr.write("OUT written " + m.a + "\\n");`,
  "its names are listed": `process.stderr.write("OUT written " + Object.keys(require("./m.cjs")) + "\\n");`,
  "it is compared": `expect(require("./m.cjs")).toEqual({ a: "first" }); process.stderr.write("OUT written\\n");`,
  "by a require that was made": `const made = createRequire(import.meta.url); process.stderr.write("OUT written " + made("./m.cjs").a + "\\n");`,
  "console.log is replaced by a write": `const log = console.log; console.log = (...all) => process.stderr.write("OUT " + all.join(" ") + "\\n"); console.log(require("./m.cjs").a); console.log = log;`,
  "what else the small streams answer": `require("./m.cjs"); process.stderr.write("OUT " + [process.stderr.fd, process.stdout.fd, process.stdin.fd, typeof process.stderr.isTTY, typeof process.stdin.isTTY].join() + "\\n");`,
  "the file is taken out and read again": `const first = require("./m.cjs"); delete require.cache[require.resolve("./m.cjs")]; process.stderr.write("OUT " + (require("./m.cjs") !== first) + "\\n");`,
  "and the whole stream where it is asked for": `require("./m.cjs"); process.stderr.once("drain", () => {}); process.stderr.write("OUT " + process.stderr.listenerCount("drain") + " " + typeof process.stderr.cork + "\\n");`,
};

async function linesOf(body: string, flags: string[], words?: string) {
  using dir = tempDir("aot-require-and-write", {
    "m.cjs": `exports.a = "first";\n`,
    "a.test.mjs": `import { test, expect } from "bun:test";\nimport { createRequire } from "node:module";\ntest("t", () => { ${body} });\n`,
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

test.concurrent.each(Object.entries(bodies))(
  "%s",
  async (_, body) => {
    const plain = await linesOf(body, []);
    expect(plain).toMatchObject({ exitCode: 0, lines: [expect.stringMatching(/^OUT /)] });
    expect(await linesOf(body, ["--aot"])).toEqual(plain);
    expect(await linesOf(body, ["--aot"], "TestRunLayers:2")).toEqual(plain);
  },
  240_000,
);
