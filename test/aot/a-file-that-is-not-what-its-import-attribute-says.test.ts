import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `with { type: "json" }` says how a file is read, whatever its name says. The loader of the run time loads the files that the build does not hold, and has
// to hear of the attribute: by the name alone it reads a .jsonc with its comment, a .toml as TOML and a .txt as a string.
const say = (name: string, value: string) => `console.log("SEEN ${name} | " + JSON.stringify(${value}));`;
const testFile = (name: string, imports: string, value: string) =>
  `import { test } from "bun:test";\n${imports}\ntest(${JSON.stringify(name)}, () => { ${say(name, value)} });\n`;

const files: Record<string, string> = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "comment.jsonc": `{\n  // a comment\n  "a": 1\n}\n`,
  "cut-off.txt": `{"a":1,\n`,
  "table.toml": `a = 1\n`,
  "good.txt": `{"a":1}\n`,
  "page.html": `<!doctype html><title>a page</title>\n`,
  "passes-on.js": `export { default as passedOn } from "./cut-off.txt" with { type: "json" };\n`,

  // The text is no JSON: plain `bun test` refuses the file that imports it. A compiled run leaves such a file to the loader.
  "a.test.js": testFile("a comment", `import x from "./comment.jsonc" with { type: "json" };`, "x"),
  "b.test.js": testFile("cut off", `import x from "./cut-off.txt" with { type: "json" };`, "x"),
  "c.test.js": testFile("toml", `import x from "./table.toml" with { type: "json" };`, "x"),
  "d.test.js": testFile("a namespace", `import * as all from "./cut-off.txt" with { type: "json" };`, "all.default"),

  // The same files read as their names say, or as text, are fine, also beside a file that asks for JSON.
  "f.test.js": testFile("by its name", `import x from "./comment.jsonc";\nimport y from "./table.toml";`, "[x, y]"),
  "g.test.js": testFile("as text", `import x from "./cut-off.txt" with { type: "text" };`, "x"),
  "h.test.js": testFile("no attribute", `import x from "./cut-off.txt";`, "x"),
  "i.test.js": testFile("toml as text", `import x from "./table.toml" with { type: "text" };`, "x"),
  "j.test.js": testFile("json in a txt", `import x from "./good.txt" with { type: "json" };`, "x"),
  "k.test.js": testFile(
    "twice in one file",
    `import x from "./comment.jsonc";\nimport y from "./comment.jsonc" with { type: "text" };`,
    "[x, y]",
  ),

  // `bun run` drops the attributes of `export .. from` and hands the text on. By the language they hold, and a compiled run reads them.
  "e.test.js": testFile("through a helper", `import { passedOn } from "./passes-on.js";`, "passedOn"),

  // A query makes one more instance of the file, which only the loader makes. A page is bundled when it is served.
  "l.test.js": testFile("a query", `import x from "./good.txt?again" with { type: "json" };`, "x"),
  "m.test.js": testFile("a page as text", `import x from "./page.html" with { type: "text" };`, "x"),

  "n.test.js": `import { test } from "bun:test";
test("import()", async () => {
  for (const name of ["./comment.jsonc", "./cut-off.txt", "./table.toml"]) {
    let said;
    try {
      said = (await import(name, { with: { type: "json" } })).default;
    } catch (error) {
      said = error.name + ": " + error.message;
    }
    ${say("import() of a name", "[name, said]")}
  }
  let said;
  try {
    said = (await import("./cut-off.txt", { with: { type: "json" } })).default;
  } catch (error) {
    said = error.name + ": " + error.message;
  }
  ${say("import() of a text", "said")}
});
`,
};

async function seenIn(words: string | undefined, ...flags: string[]) {
  using dir = tempDir("aot-import-attributes", files);
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], String(dir), env);
  const seen = stdout.split("\n").filter(line => line.startsWith("SEEN "));
  const said = stderr.split("\n").filter(line => /^(\w*Error|error): |^ *\d+ (pass|fail|error)s?$/.test(line));
  return { seen: seen.sort(), said: said.map(line => line.trim()).sort(), exitCode };
}

test("a test run reads a file as the import asks", async () => {
  const [plain, one, layers] = await Promise.all([
    seenIn(undefined),
    seenIn("TestRunLayers:0", "--aot"),
    seenIn("TestRunLayers:2,TestRunPartFiles:4", "--aot"),
  ]);
  expect(plain.said).toContain("4 fail");
  expect(plain.said.filter(line => line.startsWith("SyntaxError: JSON Parse error")).length).toBe(4);
  expect(plain.exitCode).toBe(1);
  const throughHelper = `SEEN through a helper | ${JSON.stringify('{"a":1,\n')}`;
  expect(plain.seen).toContain(throughHelper);
  expect(plain.said).toContain("10 pass");
  const counts = /^\d+ (pass|fail|errors?)$/;
  const refused = "SyntaxError: JSON Parse error: Property name must be a string literal";
  const byTheLanguage = {
    seen: plain.seen.filter(line => line !== throughHelper),
    said: [...plain.said.filter(line => !counts.test(line)), refused, "9 pass", "5 fail", "5 errors"].sort(),
    exitCode: 1,
  };
  expect(one).toEqual(byTheLanguage);
  expect(layers).toEqual(byTheLanguage);
}, 240_000);
