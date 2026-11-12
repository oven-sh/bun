// `await import(name, { with: { type: "file" } })` under a name made at the run finds the file that the program holds as a file: one module with the statement or the
// written call that names it with that type, whichever comes first, and a path that can be read. A statement without the attribute is another module, as under `bun`. Each case prints what `bun <the main file>` prints. The executable is started in an empty folder.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const read = `const read = async it => JSON.stringify(await Bun.file(it.default).text().catch(() => "unreadable"));\n`;
const made = (file: string) => `const name = process.argv[2] ?? "./${file}";\n`;
const user = (file: string) =>
  `import word, * as whole from "./${file}" with { type: "file" };\nexport { word, whole };\n`;

const cases: Record<string, Record<string, string>> = {
  "the call comes first, then the statement": {
    "note.txt": "a note\n",
    "user.mjs": user("note.txt"),
    "main.mjs": `${read}${made("note.txt")}const early = await import(name, { with: { type: "file" } });
const { word, whole } = await import("./user.mjs");
console.log(word === early.default, whole === early, await read(early));\n`,
  },
  "the call comes first, then a written call": {
    "note.txt": "a note\n",
    "main.mjs": `${read}${made("note.txt")}const early = await import(name, { with: { type: "file" } });
const written = await import("./note.txt", { with: { type: "file" } });
console.log(written === early, await read(early), await read(written));\n`,
  },
  "the statement has no attribute": {
    "note.bin": "a note\n",
    "main.mjs": `import * as whole from "./note.bin";\n${read}${made("note.bin")}const late = await import(name, { with: { type: "file" } });
console.log(whole === late, await read(late));\n`,
  },
  "a file in a folder asks": {
    "sub/note.txt": "a note\n",
    "sub/user.mjs": user("note.txt"),
    "sub/asks.mjs": `${made("note.txt")}export const early = await import(name, { with: { type: "file" } });\n`,
    "main.mjs": `${read}const { early } = await import("./sub/asks.mjs");
const { whole } = await import("./sub/user.mjs");
console.log(whole === early, await read(early));\n`,
  },
  "the namespace has the keys that bun gives it": {
    "note.txt": "a note\n",
    "main.mjs": `${read}${made("note.txt")}const show = it => Object.keys(it).join() + " " + typeof it.default + " " + it.__esModule + " " + ("__esModule" in it);
const one = await import(name, { with: { type: "file" } });
const other = await import(name, { with: { type: JSON.parse('"file"') } });
const asText = await import(name, { with: { type: JSON.parse('"text"') } });
console.log(one === other, show(one), "|", asText === one, show(asText), "|", await read(one));
if (process.argv[3]) await import("./note.txt", { with: { type: "file" } });\n`,
  },
};

// What the build read with another loader lies under the path too, and is not the file.
const readOtherwise: Record<string, Record<string, string>> = {
  "bunfig.toml gives the ending a loader": {
    "bunfig.toml": `[loader]\n".tmpl" = "text"\n`,
    "note.tmpl": "a note\n",
    "main.mjs": `const got = await import(JSON.parse('"./note.tmpl"'), { with: { type: "file" } });
console.log(typeof got.default, got.default.trim() === "a note");
if (process.argv[2]) await import("./note.tmpl");\n`,
  },
  "code under a query": {
    "side.js": `globalThis.bodies = (globalThis.bodies ?? 0) + 1;\nexport const mark = 1;\nexport default function side() {}\n`,
    "main.mjs": `if (process.argv[2]) await import("./side.js?x");
const got = await import(JSON.parse('"./side.js?x"'), { with: { type: "file" } });
console.log(typeof got.default, typeof got.mark, globalThis.bodies ?? 0);\n`,
  },
};

async function printOfBoth(files: Record<string, string>) {
  using sources = tempDir("aot-a-file-under-a-made-name", files);
  using elsewhere = tempDir("aot-a-file-under-a-made-name-run", {});
  const executable = join(String(elsewhere), isWindows ? "program.exe" : "program");
  const plain = await run([bunExe(), "main.mjs"], String(sources), bunEnv);
  expect(plain.exitCode).toBe(0);
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable],
    String(sources),
  );
  expect(built.exitCode).toBe(0);
  const compiled = await run([executable], String(elsewhere), bunEnv);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  return plain.stdout;
}

test.concurrent.each(Object.keys(cases))("%s", async name => {
  expect(await printOfBoth(cases[name])).toContain(`"a note\\n"`);
});

test.concurrent.each(Object.keys(readOtherwise))("%s", async name => {
  expect(await printOfBoth(readOtherwise[name])).toStartWith("string ");
});
