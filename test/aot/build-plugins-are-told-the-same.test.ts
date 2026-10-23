// What the hooks of a plugin of `Bun.build` are told, and when, with `compile: { aot: true }` and without `aot`: build-both-ways.ts.
import { buildBothWays } from "./build-both-ways";

const tellEverything = `build.onResolve({ filter: /.*/ }, (args: any) => void tell("onResolve", args));
build.onLoad({ filter: /.*/ }, (args: any) => void tell("onLoad", args));`;

buildBothWays("compile/aot/what the plugins of Bun.build are told", {
  "every kind of import": {
    files: {
      "main.ts": `import { a } from "./a";
import * as b from "./b.js";
export * from "./c";
import d from "./d.cjs";
const e = require("./e.cjs");
const f = await import("./f");
const g = require.resolve("./g.cjs");
const h = import.meta.resolve("./h");
console.log(a, b.b, d.d, e.e, f.f, typeof g, typeof h);`,
      "a.ts": `export const a = "a";`,
      "b.js": `export const b = "b";`,
      "c.ts": `export const c = "c";`,
      "d.cjs": `exports.d = "d";`,
      "e.cjs": `exports.e = "e";`,
      "f.ts": `export const f = "f";`,
      "g.cjs": `exports.g = "g";`,
      "h.ts": `export const h = "h";`,
      "types.d.ts": `declare const require: any;`,
    },
    plugins: [tellEverything],
    prints: "a b d e f string string\n",
    // What import.meta.resolve names is in the executable too.
    differs: {
      told: [
        ...[
          "a.ts ts",
          "b.js jsx",
          "c.ts ts",
          "d.cjs js",
          "e.cjs js",
          "f.ts ts",
          "g.cjs js",
          "h.ts ts",
          "main.ts ts",
        ].map(
          file =>
            `onLoad path="<folder>/${file.split(" ")[0]}" namespace="file" loader="${file.split(" ")[1]}" defer=function side="server"`,
        ),
        ...[
          "./a import-statement",
          "./b.js import-statement",
          "./c import-statement",
          "./d.cjs import-statement",
          "./e.cjs require-call",
          "./f dynamic-import",
          "./g.cjs require-resolve",
          "./h require-resolve",
        ].map(
          it =>
            `onResolve path="${it.split(" ")[0]}" importer="<folder>/main.ts" namespace="file" resolveDir="<folder>" kind="${it.split(" ")[1]}"`,
        ),
        `onResolve path="./main.ts" importer="" namespace="file" resolveDir="." kind="entry-point-build"`,
      ],
    },
  },
  "imports of one file from several files, and twice from one": {
    files: {
      "main.ts": `import { one } from "./shared"; import { two } from "./shared"; import { other } from "./other"; console.log(one, two, other);`,
      "other.ts": `import { one } from "./shared"; export const other = one + 1;`,
      "shared.ts": `export const one = 1; export const two = 2;`,
    },
    plugins: [tellEverything],
    prints: "1 2 2\n",
  },
  "packages, built-in modules and subpaths": {
    files: {
      "main.ts": `import { sep } from "node:path"; import { join } from "path"; import { name } from "pkg"; import { deep } from "pkg/deep"; import { scoped } from "@scope/pkg"; console.log(typeof sep, typeof join, name, deep, scoped, typeof Bun.version);`,
      "types.d.ts": `declare module "node:path" { export const sep: string; } declare module "path" { export function join(...parts: string[]): string; } declare const Bun: { version: string };`,
      "node_modules/pkg/package.json": `{ "name": "pkg", "version": "1.0.0", "exports": { ".": "./index.js", "./deep": "./lib/deep.js" } }`,
      "node_modules/pkg/index.js": `import { inner } from "./lib/inner.js"; export const name = "pkg " + inner;`,
      "node_modules/pkg/index.d.ts": `export const name: string;`,
      "node_modules/pkg/lib/inner.js": `export const inner = "inner";`,
      "node_modules/pkg/lib/deep.js": `export const deep = "deep";`,
      "node_modules/pkg/lib/deep.d.ts": `export const deep: string;`,
      "node_modules/@scope/pkg/package.json": `{ "name": "@scope/pkg", "version": "1.0.0", "main": "./main.js", "types": "./main.d.ts" }`,
      "node_modules/@scope/pkg/main.js": `exports.scoped = "scoped";`,
      "node_modules/@scope/pkg/main.d.ts": `export const scoped: string;`,
    },
    plugins: [tellEverything],
    prints: "string function pkg inner deep scoped string\n",
  },
  "imports with attributes": {
    files: {
      "main.ts": `import text from "./words.txt" with { type: "text" };
import asText from "./data.json" with { type: "text" };
import toml from "./settings.conf" with { type: "toml" };
import path from "./blob.bin" with { type: "file" };
console.log(text.trim(), (asText as unknown as string).trim(), toml.n, typeof path);`,
      "types.d.ts": `declare module "*.txt" { const text: string; export default text; } declare module "*.conf" { const value: any; export default value; } declare module "*.bin" { const path: string; export default path; }`,
      "words.txt": "words\n",
      "data.json": `{"n":1}\n`,
      "settings.conf": "n = 2\n",
      "blob.bin": "blob",
    },
    plugins: [tellEverything],
  },
  "the importer and the folder of an import from a module in a namespace": {
    files: {
      "main.ts": `// @ts-ignore\nimport { outer } from "virtual:outer"; console.log(outer);`,
      "real.ts": `export const real = "real";`,
    },
    plugins: [
      `build.onResolve({ filter: /.*/ }, (args: any) => {
  tell("onResolve", args);
  if (args.path.startsWith("virtual:")) return { path: args.path.slice(8), namespace: "virtual" };
  if (args.importer === "inner") return { path: join(folder, "real.ts") };
});
build.onResolve({ filter: /.*/, namespace: "virtual" }, (args: any) => void tell("onResolve in virtual", args));
build.onLoad({ filter: /.*/, namespace: "virtual" }, (args: any) => {
  tell("onLoad in virtual", args);
  if (args.path === "outer") return { contents: 'import { inner } from "virtual:inner"; export const outer = "outer " + inner;', loader: "js" };
  return { contents: 'import { real } from "./real"; export const inner = "inner " + real;', loader: "js" };
});
build.onLoad({ filter: /.*/ }, (args: any) => void tell("onLoad", args));`,
    ],
    prints: "outer inner real\n",
  },
  "imports that are erased, and files of the project that nothing imports": {
    files: {
      "main.ts": `import type { Shape } from "./shape"; import { type Size, size } from "./size"; import { Unused } from "./unused"; import { OnlyAType } from "./only-a-type";
const shape: Shape = { sides: 3 }; const one: Size = size; const other: OnlyAType = 2; console.log(shape.sides, one, other, typeof ambient);`,
      "shape.ts": `export interface Shape { sides: number }`,
      "size.ts": `export type Size = number; export const size: Size = 1;`,
      "unused.ts": `export const Unused = 1; console.log("unused runs");`,
      "only-a-type.ts": `export type OnlyAType = number; console.log("only-a-type runs");`,
      "not-imported.ts": `declare global { var ambient: undefined | string; }\nexport {};`,
    },
    plugins: [tellEverything],
    prints: "3 1 2 undefined\n",
  },
  "the entry point": {
    files: { "main.ts": `console.log("from the disk");` },
    plugins: [
      `build.onResolve({ filter: /main/ }, (args: any) => void tell("onResolve", args));
build.onLoad({ filter: /main\\.ts$/ }, (args: any) => { tell("onLoad", args); return { contents: 'console.log("from the plugin");', loader: "ts" }; });`,
    ],
    prints: "from the plugin\n",
  },
  "an entry point that a plugin resolves to another file": {
    files: { "main.ts": `console.log("main");`, "other.ts": `console.log("other");` },
    plugins: [
      `build.onResolve({ filter: /main/ }, (args: any) => { tell("onResolve", args); return { path: join(folder, "other.ts") }; });`,
    ],
    prints: "other\n",
  },
  "an entry point in a namespace": {
    files: { "main.ts": `console.log("main");` },
    plugins: [
      `build.onResolve({ filter: /^virtual:/ }, (args: any) => { tell("onResolve", args); return { path: "entry", namespace: "virtual" }; });
build.onLoad({ filter: /.*/, namespace: "virtual" }, (args: any) => { tell("onLoad", args); return { contents: 'console.log("virtual entry");', loader: "ts" }; });`,
    ],
    options: `entrypoints: ["virtual:entry"]`,
    prints: "virtual entry\n",
  },
  "several plugins: each is asked in order until one answers": {
    files: {
      "main.ts": `import { a } from "./a"; import { b } from "./b"; import { c } from "./c"; console.log(a, b, c);`,
      "a.ts": `export const a = "disk";`,
      "b.ts": `export const b = "disk";`,
      "c.ts": `export const c = "disk";`,
    },
    plugins: [
      `build.onLoad({ filter: /[abc]\\.ts$/ }, (args: any) => { tell("first onLoad", args); if (args.path.endsWith("a.ts")) return { contents: 'export const a = "first";', loader: "ts" }; });`,
      `build.onLoad({ filter: /[abc]\\.ts$/ }, async (args: any) => { tell("second onLoad", args); if (!args.path.endsWith("c.ts")) return { contents: 'export const a = "second", b = "second";', loader: "ts" }; return null; });`,
      `build.onLoad({ filter: /[abc]\\.ts$/ }, (args: any) => { tell("third onLoad", args); return {}; });
build.onLoad({ filter: /[abc]\\.ts$/ }, (args: any) => { tell("fourth onLoad", args); return undefined; });`,
    ],
    fails: "",
  },
  "several plugins resolve: the first answer counts": {
    files: {
      "main.ts": `import { a } from "./a"; import { b } from "./b"; console.log(a, b);`,
      "a.ts": `export const a = "a";`,
      "b.ts": `export const b = "b";`,
      "first.ts": `export const a = "first", b = "first";`,
      "second.ts": `export const a = "second", b = "second";`,
    },
    plugins: [
      `build.onResolve({ filter: /^\\.\\/[ab]$/ }, (args: any) => { tell("first onResolve", args); if (args.path === "./a") return { path: join(folder, "first.ts") }; });`,
      `build.onResolve({ filter: /^\\.\\/[ab]$/ }, async (args: any) => { tell("second onResolve", args); return { path: join(folder, "second.ts") }; });`,
      `build.onResolve({ filter: /^\\.\\/[ab]$/ }, (args: any) => { tell("third onResolve", args); return { path: join(folder, "a.ts") }; });`,
    ],
    prints: "first second\n",
  },
  "filters: only what matches is asked": {
    files: {
      "main.ts": `import { a } from "./match-a"; import { b } from "./other-b"; console.log(a, b);`,
      "match-a.ts": `export const a = "a";`,
      "other-b.ts": `export const b = "b";`,
    },
    plugins: [
      `build.onResolve({ filter: /match/ }, (args: any) => void tell("onResolve", args));
build.onLoad({ filter: /match/ }, (args: any) => void tell("onLoad", args));
build.onLoad({ filter: /MATCH/i }, (args: any) => void tell("onLoad without case", args));
build.onLoad({ filter: /match/, namespace: "elsewhere" }, (args: any) => void tell("onLoad elsewhere", args));
build.onResolve({ filter: /match/, namespace: "elsewhere" }, (args: any) => void tell("onResolve elsewhere", args));`,
    ],
    prints: "a b\n",
  },
  "onStart and onEnd": {
    files: { "main.ts": `import { a } from "./a"; console.log(a);`, "a.ts": `export const a = "a";` },
    plugins: [
      `let started = 0;
build.onStart(() => { started++; tell("first onStart"); });
build.onStart(async () => { await Bun.sleep(20); started++; tell("second onStart"); });
build.onResolve({ filter: /a$/ }, (args: any) => void tell("onResolve after " + started + " onStart"));
build.onLoad({ filter: /a\\.ts$/ }, (args: any) => void tell("onLoad after " + started + " onStart"));
build.onEnd((result: any) => void tell("first onEnd", { success: result.success, outputs: result.outputs.length, logs: result.logs.length }));
build.onEnd(async (result: any) => { await Bun.sleep(20); tell("second onEnd", { kinds: result.outputs.map((output: any) => output.kind) }); });`,
      `build.onStart(() => tell("onStart of the second plugin"));
build.onEnd(() => tell("onEnd of the second plugin"));`,
    ],
    prints: "a\n",
  },
  "what setup is given": {
    files: { "main.ts": `console.log("main");` },
    plugins: [
      `tell("setup", { config: Object.keys(build.config).sort(), entrypoints: build.config.entrypoints, define: build.config.define, members: Object.keys(build).sort(), target: build.config.target });`,
    ],
    options: `define: { WORD: '"word"' }`,
    prints: "main\n",
  },
  "defer waits for every other module": {
    files: {
      "main.ts": `import { seen } from "./seen"; import { a } from "./a"; import { b } from "./b"; console.log(seen, a, b);`,
      "seen.ts": `export const seen: string = "";`,
      "a.ts": `import { c } from "./c"; export const a = "a" + c;`,
      "b.ts": `export const b = "b";`,
      "c.ts": `export const c = "c";`,
    },
    plugins: [
      `const loaded: string[] = [];
build.onLoad({ filter: /[abc]\\.ts$/ }, (args: any) => void loaded.push(basename(args.path)));
build.onLoad({ filter: /seen\\.ts$/ }, async (args: any) => { await args.defer(); tell("onLoad behind defer", { loaded: loaded.sort() }); return { contents: "export const seen: string = " + JSON.stringify(loaded.sort().join()) + ";", loader: "ts" }; });`,
    ],
    prints: "a.ts,b.ts,c.ts ac b\n",
  },
});
