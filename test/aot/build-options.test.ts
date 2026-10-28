// The options of `Bun.build` that change what a program is made of, alone and together with plugins, with `compile: { aot: true }`
// and without `aot`: build-both-ways.ts.
import { buildBothWays } from "./build-both-ways";

const tellEverything = `build.onResolve({ filter: /.*/ }, (args: any) => void tell("onResolve", args));
build.onLoad({ filter: /.*/ }, (args: any) => void tell("onLoad", args));`;

buildBothWays("compile/aot/options of Bun.build", {
  "files: modules that are only in memory": {
    files: {
      "main.ts": `import { a } from "./memory.ts"; import { b } from "./nested/deep.ts"; import data from "./data.json"; console.log(a, b, data.n);`,
    },
    options: `files: { [join(folder, "memory.ts")]: "export const a: string = 'memory';", [join(folder, "nested/deep.ts")]: "import { a } from '../memory.ts'; export const b = a + ' deep';", "./data.json": '{ "n": 1 }' }`,
    prints: "memory memory deep 1\n",
  },
  "files: a module in memory in place of a file": {
    files: { "main.ts": `import { a } from "./lib"; console.log(a);`, "lib.ts": `export const a: string = "disk";` },
    options: `files: { [join(folder, "lib.ts")]: "export const a: number = 42;" }`,
    prints: "42\n",
  },
  "files: the entry point is in memory": {
    files: { "lib.ts": `export const a = "disk lib";` },
    options: `entrypoints: ["./entry.ts"], files: { "./entry.ts": "import { a } from './lib'; console.log('memory entry', a);" }`,
    prints: "memory entry disk lib\n",
  },
  "files: bytes, and kinds of data": {
    files: {
      "main.ts": `import text from "./note.txt"; import bytes from "./bytes.txt"; import blob from "./blob.txt"; import path from "./raw.bin" with { type: "file" }; console.log(text, bytes, blob, Array.from(await Bun.file(path).bytes()).join());`,
      "types.d.ts": `declare module "*.txt" { const text: string; export default text; } declare module "*.bin" { const path: string; export default path; } declare const Bun: any;`,
    },
    options: `files: { "./note.txt": "text", "./bytes.txt": new TextEncoder().encode("bytes"), "./blob.txt": new Blob(["blob"]), "./raw.bin": new Uint8Array([0, 255, 7]) }`,
    prints: "text bytes blob 0,255,7\n",
  },
  "files: what plugins are told about them": {
    files: { "main.ts": `import { a } from "./memory.ts"; import { b } from "./changed.ts"; console.log(a, b);` },
    options: `files: { "./memory.ts": "export const a = 'memory';", "./changed.ts": "export const b = 'memory';" }`,
    plugins: [
      tellEverything,
      `build.onLoad({ filter: /changed\\.ts$/ }, () => ({ contents: "export const b = 'plugin';", loader: "ts" }));`,
    ],
    prints: "memory plugin\n",
  },
  "files: CommonJS in memory": {
    files: {
      "main.cjs": `const lib = require("./lib.cjs"); console.log(lib.a, lib.b, Object.keys(lib).join());`,
      "lib.cjs": `exports.a = "disk"; exports.b = "disk";`,
    },
    options: `entrypoints: ["./main.cjs"], files: { "./lib.cjs": "exports.a = 'memory'; exports.c = require('./more.cjs');", "./more.cjs": "module.exports = 'more';" }`,
    prints: "memory undefined a,c\n",
  },
  "macros": {
    files: {
      "main.ts": `import { stamp, sum, table } from "./macro" with { type: "macro" }; console.log(stamp(), sum(1, 2), JSON.stringify(table("a", "b")));`,
      "macro.ts": `export function stamp() { return "made at the build " + typeof Bun; } export function sum(a: number, b: number) { return a + b; } export async function table(...names: string[]) { return Object.fromEntries(names.map((name, index) => [name, index])); }\ndeclare const Bun: unknown;`,
    },
    prints: `made at the build object 3 {"a":0,"b":1}\n`,
  },
  "macros: a plugin is not asked for the file of a macro": {
    files: {
      "main.ts": `import { word } from "./macro" with { type: "macro" }; console.log(word());`,
      "macro.ts": `export function word() { return "disk"; }`,
    },
    plugins: [
      tellEverything,
      `build.onLoad({ filter: /macro\\.ts$/ }, () => ({ contents: "export function word() { return 'plugin'; }", loader: "ts" }));`,
    ],
  },
  "macros in the text that a plugin yields": {
    files: {
      "main.ts": `import { made } from "./lib"; console.log(made);`,
      "lib.ts": `export const made: string = "disk";`,
      "macro.ts": `export function word() { return "from the macro"; }`,
    },
    plugins: [
      `build.onLoad({ filter: /lib\\.ts$/ }, () => ({ contents: 'import { word } from "./macro" with { type: "macro" }; export const made: string = word();', loader: "ts" }));`,
    ],
    prints: "from the macro\n",
  },
  "define": {
    files: {
      "main.ts": `declare const WORD: string, NUMBER: number, FLAG: boolean, OBJECT: { a: number[] }; declare const process: any;
console.log(WORD, NUMBER + 1, FLAG ? "on" : "off", OBJECT.a[1], process.env.DEFINED, typeof UNDEFINED_NAME, globalThis.WORD);
declare const UNDEFINED_NAME: unknown; declare global { var WORD: unknown; }
if (!FLAG) require("./never");
declare const require: any;`,
    },
    options: `define: { WORD: '"word"', NUMBER: "41", FLAG: "true", OBJECT: '{"a":[1,2]}', "process.env.DEFINED": '"defined"' }`,
    prints: "word 42 on 2 defined undefined undefined\n",
  },
  "define reaches the text that a plugin yields": {
    files: { "main.ts": `import { a } from "./a"; console.log(a);`, "a.ts": `export const a = "disk";` },
    options: `define: { WORD: '"word"' }`,
    plugins: [
      `build.onLoad({ filter: /a\\.ts$/ }, () => ({ contents: "declare const WORD: string; export const a = WORD;", loader: "ts" }));`,
    ],
    prints: "word\n",
  },
  "define picks the branch whose import is followed": {
    files: {
      "main.ts": `declare const MODE: string; const lib = MODE === "a" ? await import("./a") : await import("./b"); console.log(lib.name);`,
      "a.ts": `export const name = "a";`,
      "b.ts": `export const name = "b";`,
    },
    options: `define: { MODE: '"a"' }`,
    plugins: [tellEverything],
    prints: "a\n",
  },
  "the loader map": {
    files: {
      "main.ts": `import text from "./note.custom"; import data from "./data.conf"; import { code } from "./code.script"; import path from "./asset.thing"; console.log(text.trim(), data.n, code, typeof path);`,
      "types.d.ts": `declare module "*.custom" { const text: string; export default text; } declare module "*.conf" { const data: any; export default data; } declare module "*.thing" { const path: string; export default path; }`,
      "note.custom": "custom text\n",
      "data.conf": `{ "n": 1 }`,
      "code.script": `export const code: string = "typed code";`,
      "asset.thing": "asset",
    },
    options: `loader: { ".custom": "text", ".conf": "json", ".script": "ts", ".thing": "file" }`,
    plugins: [tellEverything],
    prints: "custom text 1 typed code string\n",
  },
  "the loader map changes a known extension": {
    files: {
      "main.ts": `import text from "./data.json"; import code from "./words.txt"; console.log(typeof text, (text as unknown as string).trim(), code);`,
      "types.d.ts": `declare module "*.txt";`,
      "data.json": `{ "n": 1 }\n`,
      "words.txt": `export default "code in a .txt";`,
    },
    options: `loader: { ".json": "text", ".txt": "js" }`,
    prints: `string { "n": 1 } code in a .txt\n`,
  },
  "env: inline": {
    files: {
      "main.ts": `declare const process: any; console.log(process.env.BUILD_TIME_WORD, process.env.OTHER_WORD, process.env.NOT_SET_ANYWHERE);`,
    },
    options: `env: "inline"`,
    env: { BUILD_TIME_WORD: "at the build", OTHER_WORD: "other" },
  },
  "env: a prefix": {
    files: { "main.ts": `declare const process: any; console.log(process.env.PUBLIC_WORD, process.env.PRIVATE_WORD);` },
    options: `env: "PUBLIC_*"`,
    env: { PUBLIC_WORD: "public", PRIVATE_WORD: "private" },
  },
  "env: disable": {
    files: { "main.ts": `declare const process: any; console.log(process.env.BUILD_TIME_WORD);` },
    options: `env: "disable"`,
    env: { BUILD_TIME_WORD: "word" },
  },
  "conditions": {
    files: {
      "main.ts": `import { which } from "pkg"; import { sub } from "pkg/sub"; console.log(which, sub, require("pkg").which);\ndeclare const require: any;`,
      "node_modules/pkg/package.json": JSON.stringify({
        name: "pkg",
        version: "1.0.0",
        exports: {
          ".": {
            custom: { import: "./custom.mjs", require: "./custom.cjs" },
            bun: "./bun.js",
            default: "./default.js",
          },
          "./sub": { other: "./other.js", custom: "./sub-custom.js", default: "./default.js" },
        },
      }),
      "node_modules/pkg/index.d.ts": `export const which: string, sub: string;`,
      "node_modules/pkg/custom.mjs": `export const which = "custom import";`,
      "node_modules/pkg/custom.cjs": `exports.which = "custom require";`,
      "node_modules/pkg/bun.js": `export const which = "bun";`,
      "node_modules/pkg/default.js": `export const which = "default", sub = "default";`,
      "node_modules/pkg/other.js": `export const sub = "other";`,
      "node_modules/pkg/sub-custom.js": `export const sub = "sub custom";`,
      "types.d.ts": `declare module "pkg" { export const which: string; } declare module "pkg/sub" { export const sub: string; }`,
    },
    options: `conditions: ["custom"]`,
    plugins: [tellEverything],
    prints: "custom import sub custom custom require\n",
  },
  "paths of the tsconfig": {
    files: {
      "main.ts": `import { a } from "@lib/a"; import { b } from "exact"; import { c } from "based/c"; console.log(a, b, c);`,
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          strict: true,
          module: "preserve",
          moduleResolution: "bundler",
          types: [],
          baseUrl: ".",
          paths: { "@lib/*": ["./src/lib/*"], exact: ["./src/exact.ts"] },
        },
        exclude: ["build.ts"],
      }),
      "src/lib/a.ts": `export const a = "a";`,
      "src/exact.ts": `export const b = "b";`,
      "based/c.ts": `export const c = "c";`,
    },
    plugins: [tellEverything],
    prints: "a b c\n",
  },
  "another tsconfig": {
    files: {
      "main.ts": `import { a } from "@lib/a"; console.log(a);`,
      "other.json": JSON.stringify({
        compilerOptions: {
          strict: true,
          module: "preserve",
          moduleResolution: "bundler",
          types: [],
          paths: { "@lib/*": ["./other/*"] },
        },
        exclude: ["build.ts"],
      }),
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          strict: true,
          module: "preserve",
          moduleResolution: "bundler",
          types: [],
          paths: { "@lib/*": ["./usual/*"] },
        },
        exclude: ["build.ts"],
      }),
      "other/a.ts": `export const a = "other";`,
      "usual/a.ts": `export const a = "usual";`,
    },
    options: `tsconfig: "./other.json"`,
    prints: "other\n",
  },
  "external": {
    files: {
      "main.ts": `// @ts-nocheck\nimport { a } from "outside-pkg"; import { b } from "./outside.mjs"; import { c } from "star/anything"; console.log(a, b, c);`,
      "outside.mjs": `export const b = "file at run time";`,
      "node_modules/outside-pkg/package.json": `{ "name": "outside-pkg", "version": "1.0.0", "main": "./index.js" }`,
      "node_modules/outside-pkg/index.js": `exports.a = "package at run time";`,
      "node_modules/star/package.json": `{ "name": "star", "version": "1.0.0" }`,
      "node_modules/star/anything.js": `exports.c = "pattern at run time";`,
    },
    options: `external: ["outside-pkg", "./outside.mjs", "star/*"]`,
    plugins: [tellEverything],
    interprets: true,
  },
  "packages: external": {
    files: {
      "main.ts": `// @ts-nocheck\nimport { a } from "pkg"; import { b } from "./inside"; console.log(a, b);`,
      "inside.ts": `export const b = "inside";`,
      "node_modules/pkg/package.json": `{ "name": "pkg", "version": "1.0.0", "main": "./index.js" }`,
      "node_modules/pkg/index.js": `exports.a = "package at run time";`,
    },
    options: `packages: "external"`,
    plugins: [tellEverything],
    interprets: true,
  },
  "drop": {
    files: {
      "main.ts": `console.log("kept"); console.debug("dropped?"); debugger; function noisy(): number { console.log("evaluated"); return 1; } console.error(noisy()); trace("call"); function trace(text: string) { console.log("trace", text); }`,
    },
    options: `drop: ["console.debug", "console.error", "debugger", "trace"]`,
  },
  "drop: all of console": {
    files: { "main.ts": `declare const process: any; console.log("dropped"); process.stdout.write("kept\\n");` },
    options: `drop: ["console"]`,
    prints: "kept\n",
  },
  "features": {
    files: {
      "main.ts": `import { feature } from "bun:bundle"; if (feature("ON")) console.log("on"); else console.log("not on"); if (feature("OFF")) { console.log("off is on"); require("./never"); } console.log(feature("ON") ? 1 : 2, feature("OFF") ? 1 : 2);\ndeclare const require: any;`,
      "types.d.ts": `declare module "bun:bundle" { export function feature(name: string): boolean; }`,
    },
    options: `features: ["ON"]`,
    plugins: [tellEverything],
    prints: "on\n1 2\n",
  },
  "banner and footer that are comments": {
    files: { "main.ts": `console.log("main");` },
    options: `banner: "// a banner\\n/* and more */", footer: "// a footer"`,
    prints: "main\n",
  },
  "sourcemap": {
    files: {
      "main.ts": `import { fail } from "./fail";\ntry { fail(); } catch (error: any) { console.log(error.stack.split("\\n").slice(0, 3).map((line: string) => line.replace(/[^ (]*[\\\\/]/, "")).join("|")); }`,
      "fail.ts": `// a line\n// another line\nexport function fail(): never {\n  throw new Error("failed");\n}`,
    },
    options: `sourcemap: "inline"`,
    // The positions are in the executable: there is no map beside it.
    differs: { outputs: ["entry-point"] },
  },
  "sourcemap: positions in the text that a plugin yields": {
    files: {
      "main.ts": `import { fail } from "./fail";\ntry { fail(); } catch (error: any) { console.log(error.stack.split("\\n").slice(0, 3).map((line: string) => line.replace(/[^ (]*[\\\\/]/, "")).join("|")); }`,
      "fail.ts": `export function fail(): never { throw new Error("disk"); }`,
    },
    options: `sourcemap: "inline"`,
    differs: { outputs: ["entry-point"] },
    plugins: [
      `build.onLoad({ filter: /fail\\.ts$/ }, () => ({ contents: "\\n\\n\\n\\n\\nexport function fail(): never {\\n      throw new Error('plugin');\\n}", loader: "ts" }));`,
    ],
  },
  "minify": {
    files: {
      "main.ts": `function longName(value: number) { return value * 2; } class Named {} console.log(longName(21), longName.name, Named.name, (() => {}).name);`,
    },
    options: `minify: true`,
    prints: "42 n e \n",
    // A binding that a bundle renames is shown under a short name here too. Which one is the compiler's own choice, not the bundle's.
    differs: { stdout: expect.stringMatching(/^42 [A-Za-z_$]{1,3} [A-Za-z_$]{1,3} \n$/) },
  },
  "jsx": {
    files: {
      "main.tsx": `// @ts-nocheck\nconsole.log(JSON.stringify(<a href="x"><b>t</b></a>));`,
      "node_modules/custom/package.json": `{ "name": "custom", "version": "1.0.0", "exports": { "./jsx-runtime": "./runtime.js", "./jsx-dev-runtime": "./runtime.js" } }`,
      "node_modules/custom/runtime.js": `export function jsx(type, props) { return { custom: type, ...props }; } export const jsxs = jsx, jsxDEV = jsx, Fragment = "f";`,
    },
    options: `entrypoints: ["./main.tsx"], jsx: { runtime: "automatic", importSource: "custom" }`,
    plugins: [tellEverything],
  },
  "several entry points": {
    files: {
      "main.ts": `console.log("main", (await import("./second")).name);`,
      "second.ts": `export const name = "second"; console.log("second runs");`,
    },
    options: `entrypoints: ["./main.ts", "./second.ts"]`,
    plugins: [tellEverything],
  },
  "root and naming": {
    files: {
      "src/app/main.ts": `import path from "./asset.bin" with { type: "file" }; console.log(path.replaceAll("\\\\", "/").split("/").slice(-2).join("/").replace(/-[a-z0-9]+\\./, "-hash."));`,
      "src/app/asset.bin": "asset",
      "types.d.ts": `declare module "*.bin" { const path: string; export default path; }`,
    },
    options: `entrypoints: ["./src/app/main.ts"], root: "./src"`,
  },
  "options that a build with aot refuses: a banner with code": {
    files: { "main.ts": `console.log("main", (globalThis as any).fromBanner);` },
    options: `banner: "globalThis.fromBanner = 1;"`,
    prints: "main 1\n",
    refused: "--banner with code",
  },
  "options that a build with aot refuses: a footer with code": {
    files: { "main.ts": `console.log("main");` },
    options: `footer: "console.log('footer');"`,
    prints: "main\nfooter\n",
    refused: "--footer with code",
  },
  "bytecode": {
    files: { "main.ts": `console.log("main");` },
    options: `bytecode: true`,
    prints: "main\n",
  },
  "metafile": {
    files: { "main.ts": `console.log("main");` },
    options: `metafile: true`,
    prints: "main\n",
  },
  "format cjs": {
    files: {
      "main.ts": `import { a } from "./a"; console.log("main", a, typeof require, import.meta.main);`,
      "a.ts": `export const a = 1;`,
    },
    options: `format: "cjs"`,
    prints: "main 1 function true\n",
  },
  "bytecode with a depth and format cjs": {
    files: { "main.ts": `console.log("main");` },
    options: `bytecode: true, bytecodeDepth: 1, format: "cjs"`,
    prints: "main\n",
  },
});
