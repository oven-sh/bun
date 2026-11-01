import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { waysFor } from "./harness/ways";
import { test } from "./supported";

// A file that runs again from disk is code that the build has not seen. It calls what its text imports from Bun's own modules.
const again = (lines: string) => `
  import { test } from "bun:test";
  test("runs again", () => {
    const first = require("./lib.cjs");
    delete require.cache[require.resolve("./lib.cjs")];
    const second = require("./lib.cjs");
    console.log("| " + (first === second));
    ${lines}
  });`;

const projects: Record<string, Record<string, string>> = {
  "a function that compiled code calls too": {
    "lib.cjs": `const { styleText } = require("node:util");\nexports.paint = text => styleText("red", text);`,
    "other.mjs": `import { styleText } from "node:util";\nexport const other = text => styleText("bold", text);`,
    "a.test.mjs": `import { other } from "./other.mjs";\n${again(`console.log("| " + JSON.stringify([other("y"), first.paint("x"), second.paint("x")]));`)}`,
  },
  "a function that only the file calls": {
    "lib.cjs": `const { styleText } = require("node:util");\nexports.paint = text => styleText("red", text);`,
    "a.test.mjs": again(`console.log("| " + JSON.stringify([first.paint("x"), second.paint("x")]));`),
  },
  "functions of six modules, read off the modules' objects": {
    "lib.cjs": `
      const util = require("node:util"), url = require("node:url"), crypto = require("node:crypto"), path = require("node:path"), os = require("node:os"), querystring = require("node:querystring");
      const said = call => { try { return String(call()); } catch (error) { return error.constructor.name + ": " + error.message; } };
      exports.all = () => [
        () => util.styleText("red", "x").length, () => util.format("%d", 1), () => util.inspect({}), () => util.types.isDate(1), () => typeof util.promisify(setTimeout),
        () => typeof util.deprecate(() => {}, "old"), () => util.toUSVString("a"), () => util.isDeepStrictEqual([1], [1]), () => url.fileURLToPath("file:///a/b"),
        () => url.pathToFileURL("/a/b").href, () => url.format({ protocol: "http", host: "a" }), () => crypto.createHash("sha1").update("a").digest("hex"),
        () => path.join("a", "b"), () => path.basename("/a/b.c"), () => typeof os.cpus().length, () => typeof os.platform(), () => querystring.stringify({ a: 1 }), () => querystring.parse("a=1").a,
      ].map(said);`,
    "a.test.mjs": again(`console.log("| " + second.all().join(" | "));`),
  },
  "the original beside a mock": {
    "lib.mjs": `import { styleText } from "node:util";\nexport default () => styleText("bold", "x").length;`,
    "user.mjs": `import lib from "./lib.mjs";\nexport default () => lib();`,
    "a.test.mjs": `
      import { test, vi } from "bun:test";
      import user from "./user.mjs";
      vi.mock("./lib.mjs", async importOriginal => {
        const actual = await importOriginal();
        return { ...actual, default: () => "wrapped " + actual.default() };
      });
      test("the original runs", () => console.log("| " + user()));`,
  },
};

async function report(directory: string, flags: string[], words?: string) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "."], directory, env);
  return { printed: (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("| ")), exitCode };
}

for (const [index, [title, files]] of Object.entries(projects).entries()) {
  test.concurrent(
    title,
    async () => {
      using directory = tempDir("copies-call-the-library", {
        "package.json": `{ "name": "p", "type": "module" }`,
        ...files,
      });
      const plain = await report(String(directory), []);
      expect(plain.exitCode).toBe(0);
      expect(plain.printed.join("\n")).not.toContain("Error");
      for (const words of waysFor([undefined, "TestRunLayers:2"], index === 0))
        expect(await report(String(directory), ["--aot"], words)).toEqual(plain);
    },
    120_000,
  );
}
