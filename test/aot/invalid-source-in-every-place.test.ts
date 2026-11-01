// A file with an error in it can lie anywhere in a project: at the entry point, beside it, under a tsconfig.json of its own, in a package.
// Wherever it lies the build names an error and exits with 1. What the checker alone refuses is reported for the project's own files, not for a package's.
import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { compileCommand, withThreads } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

type RefusedBy = "the parser" | "the checker" | "nothing";

const texts: Record<string, [text: string, refusedBy: RefusedBy]> = {
  "a name declared twice": ["let taken = 1; let taken = 2;", "the parser"],
  "a const without a value": ["const empty;", "the parser"],
  "break outside a loop": ["break;", "the parser"],
  "a label nobody declared": ["for (;;) break missing;", "the parser"],
  "an open brace": ["function open() {", "the parser"],
  "an open comment": ["/* open", "the parser"],
  "await outside an async function": ["function waits() { await 1; } waits();", "the parser"],
  "a private name declared twice": ["class Twice { #held = 1; #held = 2; }", "the parser"],
  "two constructors": ["class Twice { constructor() {} constructor() {} }", "the parser"],
  "a pattern that is no RegExp": ["console.log(/(/);", "the parser"],
  "an export of a name nobody declared": ["export { missing };", "the checker"],
  "a text where a number is declared": ['const count: number = "text"; console.log(count);', "the checker"],
  "an import of a name a built-in module lacks": [
    'import { missing } from "node:path"; console.log(missing);',
    "nothing",
  ],
  "nothing": ["", "nothing"],
};

const asModule = (text: string) => `${text}\nexport {};\n`;
const manifest = (fields: object) => JSON.stringify({ name: "pack", version: "1.0.0", type: "module", ...fields });

const places: Record<string, (text: string) => Record<string, string>> = {
  "the entry point": text => ({ "main.ts": asModule(text) }),
  "a second entry point": text => ({ "main.ts": asModule("console.log(1);"), "second.ts": asModule(text) }),
  "a file beside the entry point": text => ({ "main.ts": `import "./a.ts";\n`, "a.ts": asModule(text) }),
  "a file imported at run time": text => ({ "main.ts": asModule(`await import("./a.ts");`), "a.ts": asModule(text) }),
  "a file that is required": text => ({
    "main.ts": asModule(
      `const { createRequire } = await import("node:module");\ncreateRequire(import.meta.url)("./a.cjs");`,
    ),
    "a.cjs": `${text}\n`,
  }),
  "a file under a tsconfig.json of its own": text => ({
    "main.ts": `import "./sub/a.ts";\n`,
    "sub/a.ts": asModule(text),
    "sub/tsconfig.json": "{}\n",
  }),
  "a file under a strict tsconfig.json below a loose one": text => ({
    "main.ts": `import "./sub/a.ts";\n`,
    "tsconfig.json": `{ "compilerOptions": { "strict": false } }\n`,
    "sub/a.ts": asModule(text),
    "sub/tsconfig.json": `{ "compilerOptions": { "strict": true } }\n`,
  }),
  "JavaScript that its tsconfig.json has checked": text => ({
    "main.ts": `import "./sub/a.js";\n`,
    "sub/a.js": asModule(text),
    "sub/tsconfig.json": `{ "compilerOptions": { "checkJs": true, "allowJs": true } }\n`,
  }),
  "a package of JavaScript": text => ({
    "main.ts": `// @ts-ignore\nimport "pack";\n`,
    "node_modules/pack/package.json": manifest({ main: "./index.js" }),
    "node_modules/pack/index.js": asModule(text),
  }),
  "a package of TypeScript": text => ({
    "main.ts": `import "pack";\n`,
    "node_modules/pack/package.json": manifest({ exports: { ".": "./src/index.ts" } }),
    "node_modules/pack/src/index.ts": asModule(text),
  }),
  "a package of TypeScript with a tsconfig.json": text => ({
    "main.ts": `import "pack";\n`,
    "node_modules/pack/package.json": manifest({ main: "./src/index.ts" }),
    "node_modules/pack/src/index.ts": asModule(text),
    "node_modules/pack/tsconfig.json": `{ "compilerOptions": { "strict": true } }\n`,
  }),
};

for (const [place, filesWith] of Object.entries(places)) {
  test.concurrent(place, async () => {
    const isChecked = !place.startsWith("a package of TypeScript");
    const ends = await Promise.all(
      Object.entries(texts).map(async ([name, [text, refusedBy]]) => {
        const files = filesWith(text);
        using folder = tempDir("aot-invalid-source", files);
        const executable = join(String(folder), isWindows ? "program.exe" : "program");
        const entryPoints = "second.ts" in files ? ["./main.ts", "./second.ts"] : ["./main.ts"];
        // Nothing runs what a build makes here.
        const flags = [withThreads(1), "--aot-testing=NoExecutable"];
        const command = [bunExe(), ...compileCommand, ...flags, ...entryPoints, "--outfile", executable];
        const { exitCode, stderr } = await run(command, String(folder));
        const isRefused = refusedBy === "the parser" || (refusedBy === "the checker" && isChecked);
        const expected = { name, exitCode: isRefused ? 1 : 0, namesError: isRefused };
        const found = { name, exitCode, namesError: /^error: /m.test(stderr) };
        return Bun.deepEquals(found, expected) ? [found, expected] : [{ ...found, stderr }, expected];
      }),
    );
    expect(ends.map(([found]) => found)).toEqual(ends.map(([, expected]) => expected));
  });
}
