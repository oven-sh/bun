// `import data from "./data.txt" with { type: "toml" }` of a file that the program does not hold: the loader of the run time makes the
// module, and it has to hear the type that the statement writes. Without it the loader goes by the extension and answers the text.
// Every program runs under plain Bun and compiled, and both must print alike.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const shown = `const shown = value => typeof value === "object" ? "object " + value.title : typeof value + " " + JSON.stringify(String(value).slice(0, 12));`;

// What every program below prints of `file`, which holds TOML under a name that says text.
const reads = (file: string) => `
  import asToml from "${file}" with { type: "toml" };
  import asText from "${file}";
  import * as whole from "${file}" with { type: "toml" };
  import { title } from "${file}" with { type: "toml" };
  ${shown}
  export async function print() {
    console.log("the default, with the type:", shown(asToml));
    console.log("the default, without:", shown(asText));
    console.log("the namespace:", Object.keys(whole).sort().join(), whole.default === asToml);
    console.log("a name:", title);
    const again = await import("${file}", { with: { type: "toml" } });
    console.log("import() with the type:", shown(again.default), again.default === asToml, again === whole);
    console.log("import() without:", shown((await import("${file}")).default));
  }`;

const printed = (text: string) => text.split("\n").filter(line => line && !line.startsWith("bun test "));

// A test build leaves a file of data that the compiler cannot hold to the loader: a date in TOML.
const dated = (title: string) => `title = "${title}"\nwhen = 1979-05-27T07:32:00Z\n`;
const head = `import { test } from "bun:test";`;
const testFiles = {
  "package.json": `{ "type": "module" }`,
  "data/dated.txt": dated("dated"),
  "data/passed-on.txt": dated("passed on"),
  "data/shared.txt": dated("shared"),
  "data/text-first.txt": dated("text first"),
  "src/reads.js": reads("../data/dated.txt"),
  // Plain Bun drops the attribute of an export statement.
  "src/passes-on.js": `export { default as passedOn } from "../data/passed-on.txt" with { type: "toml" };\nexport * as whole from "../data/passed-on.txt" with { type: "toml" };`,
  "src/shared.js": `import shared from "../data/shared.txt" with { type: "toml" };\nexport const title = typeof shared === "object" ? shared.title : "the text";`,
  "reads.test.js": `${head}\nimport { print } from "./src/reads.js";\ntest("each way to the file", print);`,
  "in-the-test-file.test.js": `${head}
    import dated from "./data/dated.txt" with { type: "toml" };
    import { passedOn, whole } from "./src/passes-on.js";
    import { title } from "./src/shared.js";
    ${shown}
    test("in the test file", () => {
      console.log("in the test file:", shown(dated));
      console.log("export from:", shown(passedOn), Object.keys(whole).join(), shown(whole.default));
      console.log("in a file that two test files share:", title);
    });`,
  // The loader keeps one module for all the types of Bun's own: the first one that is asked for answers.
  "two-types.test.js": `${head}
    import first from "./data/text-first.txt" with { type: "text" };
    import second from "./data/text-first.txt" with { type: "toml" };
    import { title } from "./src/shared.js";
    ${shown}
    test("two types of one file", () => { console.log("text, then TOML:", shown(first), shown(second), title); });`,
};

const ways: [string, string?][] = [["one program"], ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"]];
for (const [way, words] of ways) {
  test.concurrent(`a file that a test build leaves to the loader: ${way}`, async () => {
    using dir = tempDir("import-attributes-in-a-test-run", testFiles);
    const runTests = async (env: typeof bunEnv, ...flags: string[]) => {
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], String(dir), env);
      if (exitCode !== 0) console.error(stderr);
      return { printed: printed(stdout).sort(), exitCode };
    };
    const plain = await runTests(bunEnv);
    expect(plain.printed).toContain("the default, with the type: object dated");
    expect(plain.exitCode).toBe(0);
    expect(await runTests(words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv, "--aot")).toEqual(plain);
  });
}

test.concurrent("a file that --external keeps out of an executable", async () => {
  using dir = tempDir("import-attributes-of-an-external-file", {
    "outside.txt": `title = "outside"\n`,
    "reads.js": reads("./outside.txt"),
    "main.js": `import { print } from "./reads.js";\nawait print();`,
  });
  const build = async (name: string, ...flags: string[]) => {
    const outfile = join(String(dir), name);
    const built = await run(
      [bunExe(), "build", "--compile", "--external", "./outside.txt", ...flags, "main.js", "--outfile", outfile],
      String(dir),
    );
    expect(built.stderr + built.stdout).not.toContain("error");
    expect(built.exitCode).toBe(0);
    const { stdout, stderr, exitCode } = await run([outfile], String(dir));
    if (exitCode !== 0) console.error(stderr);
    return { printed: printed(stdout), exitCode };
  };
  const plain = await build("plain");
  expect(plain.printed).toContain("the default, with the type: object outside");
  expect(await build("compiled", "--aot")).toEqual(plain);
});
