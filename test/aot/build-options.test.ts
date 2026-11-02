// The options of `Bun.build` that change what the files of a program hold, alone and together with plugins, with `compile: { aot: true }`
// and without `aot`: build-both-ways.ts. Those that change which files it has and what is written: build-options-resolving-and-output.test.ts.
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
    alone: true,
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
  "env: disable": {
    files: { "main.ts": `declare const process: any; console.log(process.env.BUILD_TIME_WORD);` },
    options: `env: "disable"`,
    env: { BUILD_TIME_WORD: "word" },
  },
});
