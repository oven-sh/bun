import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const main = `import { readdirSync } from "node:fs";
import file from "./crate.js" with { type: "file" };
console.log(await Bun.file(file).text());
console.log(readdirSync(import.meta.dirname).filter(name => name === "crate.js").join(" "));
console.log([...new Bun.Glob("crate.js").scanSync({ cwd: import.meta.dirname })].join(" "));
`;
const said = { stdout: "the data\ncrate.js\ncrate.js\n", stderr: "", exitCode: 0 };

test.each([
  ["crate.node", "no library"],
  ["crate.ts", "console.log(1 as number);\n"],
  // The copy of this source sorts in front of crate.js.
  [
    "crate.cjs",
    "module.exports = 1;\n",
    `import own from "./crate.cjs" with { type: "file" };\nif (!own) throw own;\n`,
  ],
])(
  "beside %s as an entry point",
  async (name, text, imports = "") => {
    using dir = tempDir("aot-listed-imported-file", {
      "yard/main.mjs": imports + main,
      "yard/crate.js": "the data",
      [`yard/${name}`]: text,
      "build.ts": `const result = await Bun.build({ entrypoints: ["./yard/main.mjs", "./yard/${name}"], splitting: true, naming: { asset: "[name].[ext]" }, compile: { outfile: process.argv[2], aot: true }, throw: false });
for (const log of result.logs) console.error(String(log));
process.exit(result.success ? 0 : 1);
`,
    });
    const folder = String(dir);
    expect(await run([bunExe(), "./main.mjs"], join(folder, "yard"))).toEqual(said);
    const executable = join(folder, isWindows ? "built.exe" : "built");
    const built = await run([bunExe(), "build.ts", executable], folder);
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    const elsewhere = join(folder, "elsewhere");
    mkdirSync(elsewhere);
    expect(await run([executable], elsewhere)).toEqual(said);
  },
  120_000,
);
