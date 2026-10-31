import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// stars.mjs is `export * from "./a.mjs"; export * from "./b.mjs"`, and both export `same`: stars.mjs does not export it. Code that the loader
// reads from disk and links to the compiled stars.mjs is told that the name is ambiguous, which is not the same as a name that nobody exports:
// the words of the error differ, and a further star that has the name does not supply it.
const testFile = (text: string) => `import { test } from "bun:test";\n${text}\ntest("runs", () => {});\n`;

const files: Record<string, string> = {
  "package.json": `{}`,
  "src/a.mjs": `export const same = "a"; export const onlyA = 1;`,
  "src/b.mjs": `export const same = "b"; export const onlyB = 2;`,
  "src/c.mjs": `export const same = "c"; export const onlyC = 3;`,
  "src/stars.mjs": `export * from "./a.mjs"; export * from "./b.mjs";`,
  "src/nested.mjs": `export * from "./stars.mjs";`,
  "good.test.mjs": testFile(`
    import * as stars from "./src/stars.mjs";
    import * as nested from "./src/nested.mjs";
    import { onlyC } from "./src/c.mjs";
    console.log("good:", Object.keys(stars).join(), Object.keys(nested).join(), onlyC);`),

  "src/imports-it.mjs": `import { same } from "./stars.mjs"; console.log("never printed", same);`,
  "imports-the-name.test.mjs": testFile(`
    import "./src/imports-it.mjs";
    console.log("never printed");`),

  "src/imports-it-through-a-star.mjs": `import { same } from "./nested.mjs"; console.log("never printed", same);`,
  "imports-the-name-through-a-further-star.test.mjs": testFile(`
    import "./src/imports-it-through-a-star.mjs";
    console.log("never printed");`),

  "src/imports-absent.mjs": `import { nobodyHasIt } from "./stars.mjs"; console.log("never printed", nobodyHasIt);`,
  "imports-a-name-that-nobody-exports.test.mjs": testFile(`
    import "./src/imports-absent.mjs";
    console.log("never printed");`),

  "src/further.mjs": `export * from "./stars.mjs"; export * from "./c.mjs";`,
  "src/further-the-other-way-round.mjs": `export * from "./c.mjs"; export * from "./stars.mjs";`,
  "a-copy-from-disk-with-a-further-star.test.mjs": testFile(`
    import * as first from "./src/further.mjs";
    import * as second from "./src/further-the-other-way-round.mjs";
    console.log("compiled:", Object.keys(first).join(), first.same, Object.keys(second).join(), second.same);
    delete require.cache[require.resolve("./src/further.mjs")];
    delete require.cache[require.resolve("./src/further-the-other-way-round.mjs")];
    const firstAgain = await import("./src/further.mjs");
    const secondAgain = await import("./src/further-the-other-way-round.mjs");
    console.log("from disk:", firstAgain === first, Object.keys(firstAgain).join(), firstAgain.same);
    console.log("from disk:", secondAgain === second, Object.keys(secondAgain).join(), secondAgain.same);`),
};

type Report = { printed: string; byFile: Record<string, string[]>; exitCode: number | null };

async function runTests(folder: string, flags: string[], words = ""): Promise<Report> {
  const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], folder, env);
  const byFile: Record<string, string[]> = {};
  let file = "";
  for (const line of stderr.replaceAll(folder, ".").split("\n")) {
    if (/^\S+\.test\.mjs:$/.test(line)) byFile[(file = line)] = [];
    else if (file && /^(\((pass|fail)\)|\w*[Ee]rror:)/.test(line))
      byFile[file].push(line.replace(/ \[[\d.]+ms\]$/, ""));
  }
  return { printed: stdout.replace(/^bun test .*\n/, ""), byFile, exitCode };
}

test("the loader says of the name what it says under bun test", async () => {
  using dir = tempDir("a-name-that-two-stars-export", files);
  const folder = String(dir);
  const ambiguousIn = (path: string) =>
    `SyntaxError: Export named 'same' cannot be resolved due to ambiguous multiple bindings in module '${path}'.`;
  // Over layers every test file has a realm of its own, as under --isolate.
  const runs: [string[], string[]][] = [
    [[], ["", "TestRunLayers:0"]],
    [["--isolate"], ["TestRunLayers:0", "TestRunLayers:2,TestRunPartFiles:1"]],
  ];
  for (const [flags, allWords] of runs) {
    const plain = await runTests(folder, flags);
    expect(plain.byFile).toEqual({
      "a-copy-from-disk-with-a-further-star.test.mjs:": ["(pass) runs"],
      "good.test.mjs:": ["(pass) runs"],
      "imports-a-name-that-nobody-exports.test.mjs:": [
        "SyntaxError: Export named 'nobodyHasIt' not found in module './src/stars.mjs'.",
      ],
      "imports-the-name-through-a-further-star.test.mjs:": [ambiguousIn("./src/nested.mjs")],
      "imports-the-name.test.mjs:": [ambiguousIn("./src/stars.mjs")],
    });
    expect(plain.printed).toContain("good: onlyA,onlyB onlyA,onlyB 3\n");
    expect(plain.printed).toContain("compiled: onlyA,onlyB,onlyC undefined onlyA,onlyB,onlyC undefined\n");
    expect(plain.printed).toContain(
      "from disk: false onlyA,onlyB,onlyC undefined\nfrom disk: false onlyA,onlyB,onlyC undefined\n",
    );
    for (const words of allWords)
      expect({ flags, words, ...(await runTests(folder, ["--aot", ...flags], words)) }).toEqual({
        flags,
        words,
        ...plain,
      });
  }
}, 480_000);
