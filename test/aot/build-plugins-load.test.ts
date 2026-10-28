// What onLoad and onResolve of a plugin of `Bun.build` may answer, with `compile: { aot: true }` and without `aot`: build-both-ways.ts.
import { buildBothWays } from "./build-both-ways";

// One module in a namespace for each loader: `contents` is what the plugin answers for "virtual:<name>".
function virtualModules(modules: Record<string, string>) {
  return `const modules: Record<string, () => unknown> = { ${Object.entries(modules)
    .map(([name, answer]) => `${JSON.stringify(name)}: () => (${answer})`)
    .join(", ")} };
build.onResolve({ filter: /^virtual:/ }, (args: any) => ({ path: args.path.slice(8), namespace: "virtual" }));
build.onLoad({ filter: /.*/, namespace: "virtual" }, (args: any) => modules[args.path]());`;
}

buildBothWays("compile/aot/what the plugins of Bun.build answer", {
  "loaders for code: js, jsx, ts, tsx": {
    files: {
      "main.ts": `// @ts-nocheck
import { js } from "virtual:js"; import { jsx } from "virtual:jsx"; import { ts } from "virtual:ts"; import { tsx } from "virtual:tsx";
console.log(js, JSON.stringify(jsx), ts, JSON.stringify(tsx));`,
      "node_modules/react/package.json": `{ "name": "react", "version": "19.0.0", "exports": { "./jsx-runtime": "./jsx-runtime.js", "./jsx-dev-runtime": "./jsx-runtime.js" } }`,
      "node_modules/react/jsx-runtime.js": `export function jsx(type, props) { return { type, props }; } export const jsxs = jsx, jsxDEV = jsx; export const Fragment = "fragment";`,
    },
    plugins: [
      virtualModules({
        js: `{ contents: "export const js = typeof 1;", loader: "js" }`,
        jsx: `{ contents: "export const jsx = <b id='x'>bold</b>;", loader: "jsx" }`,
        ts: `{ contents: "export const ts: string = <string>'ts';", loader: "ts" }`,
        tsx: `{ contents: "const name: string = 'i'; export const tsx = <i>{name}</i>;", loader: "tsx" }`,
      }),
    ],
  },
  "loaders for data: json, jsonc, json5, toml, yaml, text, object": {
    files: {
      "main.ts": `// @ts-nocheck
import json, { n } from "virtual:json"; import jsonc from "virtual:jsonc"; import json5 from "virtual:json5"; import toml, { table } from "virtual:toml"; import yaml from "virtual:yaml"; import text from "virtual:text"; import object, { a } from "virtual:object"; import * as all from "virtual:object";
console.log(JSON.stringify([json, n, jsonc, json5, toml, table, yaml, text, object, a, Object.keys(all).sort()]));`,
    },
    plugins: [
      virtualModules({
        json: `{ contents: '{"n":1,"list":[1,2,{"deep":null}]}', loader: "json" }`,
        jsonc: `{ contents: '{ /* note */ "n": 2, }', loader: "jsonc" }`,
        json5: `{ contents: "{ n: 3, text: 'single' }", loader: "json5" }`,
        toml: `{ contents: 'n = 4\\n[table]\\nkey = "value"\\n', loader: "toml" }`,
        yaml: `{ contents: "n: 5\\nlist:\\n  - a\\n  - b\\n", loader: "yaml" }`,
        text: `{ contents: "plain text", loader: "text" }`,
        object: `{ exports: { a: 1, b: { c: [true, null, "s"] }, default: "the default" }, loader: "object" }`,
      }),
    ],
  },
  "loaders for files: file, wasm, sqlite, napi, css, html": {
    files: {
      "main.ts": `// @ts-nocheck
import file from "virtual:file.bin"; import css from "virtual:style.css";
console.log(typeof file, await Bun.file(file).text(), typeof css);`,
    },
    plugins: [
      virtualModules({
        "file.bin": `{ contents: "the bytes of a file", loader: "file" }`,
        "style.css": `{ contents: "body { color: red }", loader: "css" }`,
      }),
    ],
  },
  "contents as bytes": {
    files: {
      "main.ts": `// @ts-nocheck
import { bytes } from "virtual:bytes"; import text from "virtual:text"; import { view } from "virtual:view"; import file from "virtual:file";
console.log(bytes, text, view, Array.from(await Bun.file(file).bytes()).join());`,
    },
    plugins: [
      virtualModules({
        bytes: `{ contents: new TextEncoder().encode("export const bytes = 'h\\u00e9llo \\u{1F600}';"), loader: "js" }`,
        text: `{ contents: new TextEncoder().encode("t\\u00e9xt"), loader: "text" }`,
        view: `{ contents: new Uint8Array(new TextEncoder().encode("xxexport const view = 'view';yy").buffer, 2, 27), loader: "js" }`,
        file: `{ contents: new Uint8Array([0, 255, 128, 10, 13]), loader: "file" }`,
      }),
    ],
  },
  "no loader in the answer: the one that the hook was told": {
    files: {
      "main.ts": `import { a } from "./a"; import b from "./b.json"; import c from "./c.txt"; console.log(a, b.n, c);`,
      "types.d.ts": `declare module "*.txt" { const text: string; export default text; }`,
      "a.ts": `export const a: string = "disk";`,
      "b.json": `{ "n": 0 }`,
      "c.txt": "disk",
    },
    plugins: [
      `build.onLoad({ filter: /a\\.ts$/ }, () => ({ contents: "export const a: string = 'plugin';" }));
build.onLoad({ filter: /b\\.json$/ }, () => ({ contents: '{ "n": 1 }' }));
build.onLoad({ filter: /c\\.txt$/ }, () => ({ contents: "plugin" }));`,
    ],
    prints: "plugin 1 plugin\n",
  },
  "answers that come late": {
    files: {
      "main.ts": `import { a } from "./a"; import { b } from "./b"; console.log(a, b);`,
      "a.ts": `export const a = "disk";`,
      "b.ts": `export const b = "disk";`,
      "c.ts": `export const b = "c";`,
    },
    plugins: [
      `build.onLoad({ filter: /a\\.ts$/ }, async () => { await Bun.sleep(50); return { contents: 'export const a = "late";', loader: "ts" }; });
build.onResolve({ filter: /^\\.\\/b$/ }, () => new Promise(resolve => setTimeout(() => resolve({ path: join(folder, "c.ts") }), 50)));`,
    ],
    prints: "late c\n",
  },
  "onResolve: external": {
    files: {
      "main.ts": `// @ts-ignore\nimport { outside } from "./outside.mjs"; // @ts-ignore\nimport { renamed } from "somewhere"; console.log(outside, renamed);`,
      "outside.mjs": `export const outside = "loaded at run time";`,
      "renamed.mjs": `export const renamed = "renamed at run time";`,
    },
    plugins: [
      `build.onResolve({ filter: /outside/ }, (args: any) => ({ path: join(folder, "outside.mjs"), external: true }));
build.onResolve({ filter: /^somewhere$/ }, (args: any) => ({ path: join(folder, "renamed.mjs"), external: true }));`,
    ],
    interprets: true,
    prints: "loaded at run time renamed at run time\n",
  },
  "onResolve: external, required": {
    files: {
      "main.cjs": `const { outside } = require("./outside.cjs"); console.log(outside, require("node-like"));`,
      "outside.cjs": `exports.outside = "loaded at run time";`,
      "like.cjs": `module.exports = "like";`,
    },
    plugins: [
      `build.onResolve({ filter: /outside/ }, (args: any) => ({ path: join(folder, "outside.cjs"), external: true }));
build.onResolve({ filter: /^node-like$/ }, (args: any) => ({ path: join(folder, "like.cjs"), external: true }));`,
    ],
    options: `entrypoints: ["./main.cjs"]`,
    interprets: true,
    prints: "loaded at run time like\n",
  },
  "onResolve: a file that does not exist": {
    files: { "main.ts": `// @ts-ignore\nimport { a } from "./a"; console.log(a);`, "a.ts": `export const a = 1;` },
    plugins: [`build.onResolve({ filter: /^\\.\\/a$/ }, () => ({ path: join(folder, "missing.ts") }));`],
    fails: "missing.ts",
  },
  "onResolve: a file that does not exist, which onLoad supplies": {
    files: { "main.ts": `// @ts-ignore\nimport { a } from "./a"; console.log(a);` },
    plugins: [
      `build.onResolve({ filter: /^\\.\\/a$/ }, () => ({ path: join(folder, "made-up.ts") }));
build.onLoad({ filter: /made-up\\.ts$/ }, () => ({ contents: "export const a: number = 7;", loader: "ts" }));`,
    ],
    prints: "7\n",
  },
  "onResolve: a namespace without onLoad": {
    files: { "main.ts": `// @ts-ignore\nimport { a } from "./a"; console.log(a);`, "a.ts": `export const a = 1;` },
    plugins: [`build.onResolve({ filter: /^\\.\\/a$/ }, () => ({ path: "a", namespace: "nobody" }));`],
    fails: "nobody",
  },
  "onResolve: a relative path in the namespace file": {
    files: { "main.ts": `// @ts-ignore\nimport { a } from "./a"; console.log(a);`, "a.ts": `export const a = 1;` },
    plugins: [`build.onResolve({ filter: /^\\.\\/a$/ }, () => ({ path: "./a.ts" }));`],
    fails: "must be absolute",
  },
  "onResolve: one path in two namespaces is two modules": {
    files: {
      "main.ts": `// @ts-nocheck\nimport { which as one } from "one:same"; import { which as two } from "two:same"; import { which as again } from "one:same"; console.log(one, two, again);`,
    },
    plugins: [
      `build.onResolve({ filter: /^(one|two):/ }, (args: any) => ({ path: args.path.slice(4), namespace: args.path.slice(0, 3) }));
let loads = 0;
build.onLoad({ filter: /.*/, namespace: "one" }, (args: any) => ({ contents: "export const which = 'one " + ++loads + "';", loader: "js" }));
build.onLoad({ filter: /.*/, namespace: "two" }, (args: any) => ({ contents: "export const which = 'two';", loader: "js" }));`,
    ],
    prints: "one 1 one 1 one 1\n",
    // Without `aot` a module is known by its path alone, and the second namespace gets the module of the first.
    differs: { stdout: "one 1 two one 1\n" },
  },
  "onLoad for a package in node_modules": {
    files: {
      "main.ts": `import { name } from "pkg"; console.log(name);`,
      "node_modules/pkg/package.json": `{ "name": "pkg", "version": "1.0.0", "main": "./index.js", "types": "./index.d.ts" }`,
      "node_modules/pkg/index.js": `exports.name = "from the disk";`,
      "node_modules/pkg/index.d.ts": `export const name: string;`,
    },
    plugins: [
      `build.onLoad({ filter: /node_modules[\\\\/]pkg[\\\\/]index\\.js$/ }, () => ({ contents: 'exports.name = "from the plugin";', loader: "js" }));`,
    ],
    prints: "from the plugin\n",
  },
  "onResolve for a package that is not installed": {
    files: {
      "main.ts": `// @ts-ignore\nimport { name } from "not-installed"; import { sub } from "not-installed/sub"; console.log(name, sub);`,
      "stand-in.ts": `export const name = "stand-in", sub = "sub";`,
    },
    plugins: [`build.onResolve({ filter: /^not-installed/ }, () => ({ path: join(folder, "stand-in.ts") }));`],
  },
  "onResolve for a built-in module": {
    files: {
      "main.ts": `// @ts-nocheck\nimport { sep } from "node:path"; import os from "os"; import { version } from "bun"; console.log(sep, typeof os, typeof version);`,
      "stand-in.ts": `export const sep = "stand-in"; export default "stand-in"; export const version = 1;`,
    },
    plugins: [
      `build.onResolve({ filter: /^(node:path|os|bun)$/ }, (args: any) => { tell("onResolve", args); return { path: join(folder, "stand-in.ts") }; });`,
    ],
  },
  "relative imports from a module in a namespace": {
    files: {
      "main.ts": `// @ts-nocheck\nimport { value } from "virtual:top"; console.log(value);`,
      "beside.ts": `export const beside = "beside";`,
    },
    plugins: [
      `build.onResolve({ filter: /^virtual:/ }, (args: any) => ({ path: join(folder, "made-up", args.path.slice(8)), namespace: "virtual" }));
build.onLoad({ filter: /.*/, namespace: "virtual" }, (args: any) => ({ contents: 'import { beside } from "../beside"; export const value = "top " + beside;', loader: "ts" }));`,
    ],
  },
  "a file imported with attributes": {
    files: {
      "main.ts": `import text from "./note.md" with { type: "text" }; import data from "./data.json" with { type: "json" }; console.log(text, data.n);`,
      "types.d.ts": `declare module "*.md" { const text: string; export default text; }`,
      "note.md": "disk",
      "data.json": `{ "n": 0 }`,
    },
    plugins: [
      `build.onLoad({ filter: /note\\.md$/ }, (args: any) => { tell("onLoad", args); return { contents: "plugin" }; });
build.onLoad({ filter: /data\\.json$/ }, (args: any) => { tell("onLoad", args); return { contents: '{ "n": 1 }' }; });`,
    ],
    prints: "<p>plugin</p>\n 1\n",
  },
  "the types are those of the text that the plugin yields": {
    files: {
      "main.ts": `import { value } from "./lib"; const n: number = value; console.log(typeof n, n);`,
      "lib.ts": `export const value: number = 1;`,
    },
    plugins: [
      `build.onLoad({ filter: /lib\\.ts$/ }, () => ({ contents: 'export const value: any = "a string";', loader: "ts" }));`,
    ],
    prints: "string a string\n",
  },
  // The checker resolves an import as TypeScript does, so it reads the file that is written. What runs is the file that onResolve picks.
  "onResolve picks a file whose values do not have the types of the file that is written": {
    files: {
      "main.ts": `import { value, list, make } from "./lib"; console.log(typeof value, value, list.length, typeof list[0], JSON.stringify(make()));`,
      "lib.ts": `export const value: number = 1; export const list: number[] = [1, 2, 3]; export function make(): { a: number; b: number } { return { a: 1, b: 2 }; }`,
      "picked.ts": `export const value: string = "text"; export const list: string[] = ["x"]; export function make(): { b: string } { return { b: "only b" }; }`,
    },
    plugins: [`build.onResolve({ filter: /^\\.\\/lib$/ }, () => ({ path: join(folder, "picked.ts") }));`],
    prints: `string text 1 string {"b":"only b"}\n`,
  },
  "a worker whose file a plugin supplies": {
    files: {
      "main.ts": `declare const Worker: any; const worker = new Worker("./worker.ts"); worker.onmessage = (event: any) => { console.log(event.data); worker.terminate(); };`,
      "worker.ts": `declare const postMessage: any; postMessage("worker on the disk");`,
    },
    plugins: [
      `build.onLoad({ filter: /worker\\.ts$/ }, (args: any) => { tell("onLoad", args); return { contents: 'declare const postMessage: any; postMessage("worker from the plugin");', loader: "ts" }; });`,
    ],
    options: `entrypoints: ["./main.ts", "./worker.ts"]`,
    prints: "worker from the plugin\n",
  },
  "an ambient declaration says one type, the text of the plugin has another": {
    files: {
      "main.ts": `import count, { list } from "virtual:numbers"; const n: number = count; const all: number[] = list; console.log(typeof n, n, all.length, typeof all[0]);`,
      "types.d.ts": `declare module "virtual:numbers" { const count: number; export default count; export const list: number[]; }`,
    },
    plugins: [
      `build.onResolve({ filter: /^virtual:/ }, (args: any) => ({ path: args.path.slice(8), namespace: "virtual" }));
build.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({ contents: 'export default "not a number"; export const list = ["a", "b"];', loader: "js" }));`,
    ],
    prints: "string not a number 2 string\n",
  },
  "one file imported with two loaders": {
    files: {
      "main.ts": `import data from "./data.json"; import text from "./data.json" with { type: "text" }; console.log(data.n, typeof text, JSON.stringify(text));`,
      "data.json": `{ "n": 0 }`,
    },
    plugins: [
      `build.onLoad({ filter: /data\\.json$/ }, (args: any) => { tell("onLoad", args); return { contents: '{ "n": 1 }' }; });`,
    ],
  },
});
