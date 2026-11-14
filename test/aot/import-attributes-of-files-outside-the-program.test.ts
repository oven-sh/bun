// `import data from "./data.txt" with { type: "toml" }` of a file that the program does not hold: the loader of the run time makes the
// module, and it has to hear the type that the statement writes. Without it the loader goes by the extension and answers the text.
// The program runs bundled and compiled, and both must print alike, but for the type that an export statement writes.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
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

test("a file that --external keeps out of an executable", async () => {
  using dir = tempDir("import-attributes-of-an-external-file", {
    "outside.txt": `title = "outside"\n`,
    "reads.js": reads("./outside.txt"),
    "passes-on.js": `export { default as passedOn } from "./outside.txt" with { type: "toml" };`,
    "main.js": `import { print } from "./reads.js";\nimport { passedOn } from "./passes-on.js";\n${shown}\nawait print();\nconsole.log("export from:", shown(passedOn));`,
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
  expect(plain.printed).toContain(`export from: string ${JSON.stringify('title = "out')}`);
  const byTheLanguage = plain.printed.map(line =>
    line.startsWith("export from:") ? "export from: object outside" : line,
  );
  expect(await build("compiled", "--aot")).toEqual({ printed: byTheLanguage, exitCode: 0 });
});
