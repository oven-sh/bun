import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// A test suite holds fixtures that no compiler takes: broken on purpose, no code at all, or odd bytes. Each of these is imported by one test, in a `try`.
// Plain `bun test` loses nothing to them but that import. A compiled run sees them all when it is built, and must lose no more.
const odd: Record<string, string | Buffer> = {
  "empty.js": "",
  "bom.js": Buffer.from('﻿export default "bom";\n'),
  "utf16.js": Buffer.from('﻿export default "utf16";\n', "utf16le"),
  "garbage.js": Buffer.from(Array.from({ length: 2048 }, (_, index) => index & 255)),
  "hashbang.js": '#!/usr/bin/env node\nexport default "hashbang";\n',
  "nul.js": 'export default "nul";\n\0\0',
  "latin1.js": Buffer.from('export default "caf\xe9".length;\n', "latin1"),
  "crlf.js": "export default `a\r\nb`.length;\r\n",
  "only-comment.js": "// nothing\n",
  "unterminated.js": "export default `never closed",
  "syntax-error.js": "export const broken = ;\n",
  "bad-regexp.js": "export default /(?<n>a)(?<n>b)/.source;\n",
  "dup-export.js": "export const a = 1;\nexport const a = 2;\n",
  "await-in-cjs.cjs": "const x = await 1;\nmodule.exports = x;\n",
  "with.cjs": "with ({ a: 1 }) { module.exports = a; }\n",
  "octal.cjs": "module.exports = 010;\n",
  "huge-line.js": `export default [${"1,".repeat(100_000)}].length;\n`,
  "too-deep.js": `export default ${"(".repeat(30_000)}1${")".repeat(30_000)};\n`,
  "big.json": `[${Array.from({ length: 20_000 }, (_, index) => `{"a":${index}}`).join(",")}]`,
  "bad.json": '{ "a": }',
  "style.css": ".a { color: red }\n",
  "types-only.d.ts": "export declare const t: number;\n",
  "ts-error.ts": "export default (1 as string).length;\n",
  "decorators.ts":
    "function d(t: any, c?: any) { return t; }\n@d class A { @d m() { return 1; } }\nexport default new A().m();\n",
  "enum.ts": "export const enum E { A = 1 }\nexport default E.A;\n",
  "dir/index.js": 'export default "index of a folder";\n',
  "throws.js": 'throw new RangeError("thrown while it loads");\n',
  "tla-rejects.js": 'await Promise.reject(new TypeError("rejected at the top"));\n',
  "cycle-a.js": 'import b from "./cycle-b.js";\nexport default "a" + b;\n',
  "cycle-b.js": 'import a from "./cycle-a.js";\nexport default "b" + typeof a;\n',
};
const links: Record<string, string> = isWindows
  ? {}
  : { "link.js": "hashbang.js", "dangling.js": "missing-target.js", "loop.js": "loop.js" };
const imported = [...Object.keys(odd).map(name => name.replace("/index.js", "")), ...Object.keys(links)];

const files: Record<string, string | Buffer> = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": `{}`,
  "good.test.js": `import { test } from "bun:test";\ntest("good", () => { console.log("SEEN a good file"); });\n`,
};
for (const [name, bytes] of Object.entries(odd)) files["odd/" + name] = bytes;
for (const [index, name] of imported.entries()) {
  files[`t${String(index).padStart(2, "0")}.test.js`] = `import { test } from "bun:test";
test(${JSON.stringify(name)}, async () => {
  let said;
  try {
    const value = (await import(${JSON.stringify("./odd/" + name)})).default;
    said = Array.isArray(value) ? "a list of " + value.length : typeof value === "object" && value !== null ? "an object" : String(value);
  } catch (error) {
    said = "throws " + error.name;
  }
  console.log("SEEN " + ${JSON.stringify(name)} + " | " + said);
});
`;
}

async function seenIn(words: string | undefined, ...flags: string[]) {
  using dir = tempDir("aot-odd-files", files);
  for (const [name, target] of Object.entries(links)) symlinkSync(target, join(String(dir), "odd", name));
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], String(dir), env);
  const seen = stdout.split("\n").filter(line => line.startsWith("SEEN "));
  return { seen: seen.sort(), exitCode };
}

test("a fixture that cannot be compiled costs the test that imports it and no other", async () => {
  const [plain, one, layers] = await Promise.all([
    seenIn(undefined),
    seenIn("TestRunLayers:0", "--aot"),
    seenIn("TestRunLayers:2,TestRunPartFiles:8", "--aot"),
  ]);
  expect(plain.seen.length).toBe(imported.length + 1);
  expect(plain.exitCode).toBe(0);
  expect(one).toEqual(plain);
  expect(layers).toEqual(plain);
}, 240_000);
