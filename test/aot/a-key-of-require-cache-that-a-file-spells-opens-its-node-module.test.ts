import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

// supported.ts sets the limit for the first file of a process alone.
raiseDefaultTimeout(120_000);

// A test run compiles the Node.js modules that a program takes. `require.cache["fs"] = { exports: fake }` puts something else in their place, so the build has to read the key and leave
// that module open. It reads a key that a file spells: a string, a name, require.resolve() of a string, a constant behind any number of names.
const head = `import { test } from "bun:test";\nconst fake = { exports: { marker: "fake" }, loaded: true };`;
// Nothing else in the file spells the key: that would open the module for it.
const form = (name: string, description: string, before: string, key: string) => ({
  [`${name}/one.test.js`]: `${head}
    test("${description}", () => {
      ${before}
      console.log("${name} before:", typeof require("${name}"), require("${name}").marker);
      require.cache[${key}] = fake;
      console.log("${name} behind:", require("${name}").marker);
      delete require.cache[${key}];
      console.log("${name} taken out:", typeof require("${name}"), require("${name}").marker);
    });`,
});

const project = {
  "package.json": `{ "type": "module" }`,
  ...form("fs", "by a string", "", `"fs"`),
  ...form("path", "by require.resolve() of a string", "", `require.resolve("path")`),
  ...form("os", "by a constant", `const key = "os";`, "key"),
  ...form("url", "by a constant behind four names", `const a = "url", b = a, c = b, d = c;`, "d"),
  ...form("util", "by a constant behind six names", `const a = "util", b = a, c = b, d = c, e = d, f = e;`, "f"),
  ...form(
    "zlib",
    "by require.resolve() behind five names",
    `const a = require.resolve("zlib"), b = a, c = b, d = c, e = d;`,
    "e",
  ),
};

const ways: [string, Record<string, string>][] = [
  ["as one program", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" }],
  ["in layers", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" }],
];

async function runTests(directory: string, env: Record<string, string>, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, {
    ...bunEnv,
    ...env,
  });
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  const printed = stdout.split("\n").filter(line => line && !line.startsWith("bun test "));
  return { printed: printed.sort(), results: results.sort(), exitCode };
}

for (const [way, env] of ways) {
  test.concurrent(`a key of require.cache that a file spells answers require(), ${way}`, async () => {
    using dir = tempDir("a-key-that-a-file-spells", project);
    const plain = await runTests(String(dir), {});
    expect(plain.results.filter(result => result.startsWith("fail"))).toEqual([]);
    for (const name of ["fs", "os", "path", "url", "util", "zlib"])
      expect(plain.printed).toContain(`${name} behind: fake`);
    expect(await runTests(String(dir), env, "--aot")).toEqual(plain);
  });
}
