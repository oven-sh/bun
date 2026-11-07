import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const manifest = (name: string, fields: object) => JSON.stringify({ name, version: "1.0.0", ...fields });
const names = [
  "by-index",
  "by-main",
  "by-exports",
  "by-exports/sub",
  "by-module",
  "@scope/by-main",
  "by-type",
  "by-imports",
  "by-main/package.json",
  "by-main/lib/main",
];

const files = {
  "src/main.ts": `import path from "node:path";
for (const file of process.argv.slice(2)) await import(path.resolve(file));
`,
  "tsconfig.json": `{ "compilerOptions": { "experimentalDecorators": true, "paths": { "@lib/*": ["./lib/*"] } } }`,
  "lib/x.ts": `export const how: string = "tsconfig paths";`,
  "node_modules/by-index/package.json": manifest("by-index", {}),
  "node_modules/by-index/index.js": `exports.how = "index.js";`,
  "node_modules/by-main/package.json": manifest("by-main", { main: "./lib/main.js" }),
  "node_modules/by-main/lib/main.js": `exports.how = "main";`,
  "node_modules/by-exports/package.json": manifest("by-exports", {
    exports: { ".": { import: "./lib/i.mjs", require: "./lib/r.cjs" }, "./sub": "./lib/sub.js" },
  }),
  "node_modules/by-exports/lib/i.mjs": `export const how = "exports import";`,
  "node_modules/by-exports/lib/r.cjs": `exports.how = "exports require";`,
  "node_modules/by-exports/lib/sub.js": `exports.how = "exports sub";`,
  "node_modules/by-module/package.json": manifest("by-module", { main: "./lib/main.js", module: "./lib/esm.mjs" }),
  "node_modules/by-module/lib/main.js": `exports.how = "main beside module";`,
  "node_modules/by-module/lib/esm.mjs": `export const how = "module";`,
  "node_modules/@scope/by-main/package.json": manifest("@scope/by-main", { main: "./lib/main.js" }),
  "node_modules/@scope/by-main/lib/main.js": `exports.how = "scoped main";`,
  "node_modules/by-type/package.json": manifest("by-type", { type: "module", main: "./lib/main.js" }),
  "node_modules/by-type/lib/main.js": `export const how = "type module";`,
  "node_modules/by-imports/package.json": manifest("by-imports", {
    main: "./lib/main.js",
    imports: { "#inner": "./lib/inner.js" },
  }),
  "node_modules/by-imports/lib/main.js": `exports.how = require("#inner");`,
  "node_modules/by-imports/lib/inner.js": `module.exports = "imports map";`,
  "scripts/use.cjs": `for (const name of ${JSON.stringify(names)}) {
  const it = require(name);
  console.log("require", name, it.how ?? it.name);
}
`,
  "scripts/use.mjs": `for (const name of ${JSON.stringify(names)}) {
  const it = await import(name);
  console.log("import", name, it.how ?? it.default.how ?? it.default.name);
}
`,
  "scripts/static.ts": `import { how as main } from "by-main";
import { how as exported } from "by-exports";
import { how as scoped } from "@scope/by-main";
import { how as alias } from "@lib/x";
console.log("static", main, "|", exported, "|", scoped, "|", alias);
function mark(_: unknown, __: string, descriptor: PropertyDescriptor) {
  console.log("decorator of tsconfig", typeof descriptor.value);
}
class Marked {
  @mark method() {}
}
new Marked().method();
`,
};
const scripts = ["scripts/use.cjs", "scripts/use.mjs", "scripts/static.ts"];

test("a file on disk finds packages and path aliases on disk as under bun run", async () => {
  using dir = tempDir("aot-code-from-disk-resolves", files);
  const directory = String(dir);
  const plain = await run([bunExe(), "src/main.ts", ...scripts], directory, bunEnv);
  expect(plain.stdout).toContain("require by-exports exports require\n");
  expect(plain.stdout).toContain("static main | exports import | scoped main | tsconfig paths\n");
  expect(plain.stdout).toContain("decorator of tsconfig function\n");
  expect(plain.exitCode).toBe(0);

  const outfile = join(directory, process.platform === "win32" ? "app.exe" : "app");
  const flags = ["--compile", "--aot", "--aot-allow-code-from-disk"];
  const build = await run([bunExe(), "build", ...flags, "./src/main.ts", "--outfile", outfile], directory, bunEnv);
  expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  const compiled = await run([outfile, ...scripts], directory, bunEnv);
  expect({ stdout: compiled.stdout, stderr: compiled.stderr, exitCode: compiled.exitCode }).toEqual({
    stdout: plain.stdout,
    stderr: plain.stderr,
    exitCode: 0,
  });
}, 150_000);
