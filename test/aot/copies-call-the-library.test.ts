import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
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

// A run in which a file runs again from disk holds much of Bun's own library, whatever else it holds: the three projects of that kind are folders of one project and share its
// two runs. The build finds the same for the three together as for each alone: they load compiled files by name. The project with the mock loads nothing by name, and beside the
// others the whole run would load code by name: it runs alone. The fault showed as one program. Each folder marks what it prints and the names of its tests.
const sharesARunWith = (title: string) =>
  Object.keys(projects).filter(
    other => (other === "the original beside a mock") === (title === "the original beside a mock"),
  );
const folderOf = (title: string) => `c${Object.keys(projects).indexOf(title) + 1}`;
const runs = new Map<string, Promise<{ lines: string[]; exitCode: number | null }>>();
const ranWith = (together: string[], ...flags: string[]) =>
  runs.getOrInsertComputed([...together, ...flags].join(" "), async () => {
    using directory = tempDir("copies-call-the-library", {
      "package.json": `{ "name": "p", "type": "module" }`,
      ...Object.fromEntries(
        together.flatMap(title =>
          Object.entries(projects[title]).map(([path, text]) => [
            `${folderOf(title)}/${path}`,
            text.replaceAll(`"| "`, `"| ${folderOf(title)} "`).replaceAll(`test("`, `test("${folderOf(title)} `),
          ]),
        ),
      ),
    });
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "."], String(directory), bunEnv);
    return { lines: (stdout + "\n" + stderr).split("\n"), exitCode };
  });

async function report(title: string, ...flags: string[]) {
  const { lines, exitCode } = await ranWith(sharesARunWith(title), ...flags);
  const failed = lines.filter(line => line.startsWith("(fail) "));
  const own = failed.filter(line => line.startsWith(`(fail) ${folderOf(title)} `));
  return {
    printed: lines.filter(line => line.startsWith(`| ${folderOf(title)} `)),
    failed: own.length,
    // A run ends with 1 where a test has failed: that is held against the project of that test alone.
    exitCode: exitCode === 1 && failed.length > 0 && own.length === 0 ? 0 : exitCode,
  };
}

for (const title of Object.keys(projects)) {
  test.concurrent(
    title,
    async () => {
      const plain = await report(title);
      expect({ failed: plain.failed, exitCode: plain.exitCode }).toEqual({ failed: 0, exitCode: 0 });
      expect(plain.printed.length).toBeGreaterThan(0);
      expect(plain.printed.join("\n")).not.toContain("Error");
      expect(await report(title, "--aot")).toEqual(plain);
    },
    120_000,
  );
}
