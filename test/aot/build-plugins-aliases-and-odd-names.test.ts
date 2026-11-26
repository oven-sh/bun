// Plugins of `Bun.build` that give modules other names: aliases for packages and built-in modules, query strings, names that are no
// file names, packages behind symbolic links. With `compile: { aot: true }` and without `aot`: build-both-ways.ts.
import { buildBothWays } from "./build-both-ways";

const virtual = `build.onResolve({ filter: /^virtual:/ }, (args: any) => ({ path: args.path.slice(8), namespace: "virtual" }));`;

buildBothWays("compile/aot/aliases and odd names from the plugins of Bun.build", {
  "an alias for a built-in module, external": {
    files: {
      "main.ts": `// @ts-nocheck\nimport { basename } from "my-path"; import os from "my-os"; const fs = require("my-fs"); console.log(basename("/a/b.txt"), typeof os.cpus, typeof fs.readFileSync);`,
    },
    plugins: [
      `build.onResolve({ filter: /^my-(path|os|fs)$/ }, (args: any) => ({ path: "node:" + args.path.slice(3), external: true }));`,
    ],
    prints: "b.txt function function\n",
  },
  "an alias for a module of Bun, external": {
    files: {
      "main.ts": `// @ts-nocheck\nimport { Database } from "my-sqlite"; const db = new Database(":memory:"); console.log(JSON.stringify(db.query("select 1 as one").get()));`,
    },
    plugins: [`build.onResolve({ filter: /^my-sqlite$/ }, () => ({ path: "bun:sqlite", external: true }));`],
    prints: `{"one":1}\n`,
  },
  "an alias from one package to another": {
    files: {
      "main.ts": `import { name } from "written"; import { deep } from "written/deep"; console.log(name, deep);`,
      "types.d.ts": `declare module "written" { export const name: string; } declare module "written/deep" { export const deep: string; }`,
      "node_modules/written/package.json": `{ "name": "written", "version": "1.0.0", "main": "./index.js" }`,
      "node_modules/written/index.js": `exports.name = "written";`,
      "node_modules/written/deep.js": `exports.deep = "written deep";`,
      "node_modules/picked/package.json": `{ "name": "picked", "version": "1.0.0", "main": "./index.js" }`,
      "node_modules/picked/index.js": `exports.name = "picked " + require("./inner").inner;`,
      "node_modules/picked/inner.js": `exports.inner = "inner";`,
      "node_modules/picked/deep.js": `exports.deep = "picked deep";`,
    },
    plugins: [
      `build.onResolve({ filter: /^written(\\/|$)/ }, (args: any) => ({ path: join(folder, "node_modules/picked", args.path === "written" ? "index.js" : args.path.slice(8) + ".js") }));`,
    ],
    prints: "picked inner picked deep\n",
  },
  // As `bun run` with the plugin: the name is the path of the module. Without `aot` an executable holds nothing under the path.
  "a name made at run time is the path of a module of a plugin that ends in a type, import()": {
    files: {
      "main.ts": `// @ts-nocheck
import written from "./notes.md?text";
const name = ["./notes.md", String(globalThis.nothing ?? "text")].join("?");
console.log(written, await import(name).then(found => found.default === written, error => error.code));`,
      "notes.md": "on the disk",
    },
    plugins: [
      `build.onResolve({ filter: /\\.md\\?text$/ }, (args: any) => ({ path: join(args.resolveDir, args.path) }));
build.onLoad({ filter: /\\.md\\?text$/ }, () => ({ contents: "made by the plugin", loader: "text" }));`,
    ],
    differs: { exitCode: 0, stdout: "made by the plugin true\n" },
  },
  "a name made at run time is the path of a module of a plugin that ends in a type, require()": {
    files: {
      "main.cjs": `const textOf = found => (typeof found === "string" ? found : found.default);
const written = require("./notes.md?text");
const name = ["./notes.md", String(globalThis.nothing ?? "text")].join("?");
try {
  console.log(textOf(written), textOf(require(name)) === textOf(written));
} catch (error) {
  console.log(textOf(written), error.code);
}`,
      "notes.md": "on the disk",
    },
    options: `entrypoints: ["./main.cjs"]`,
    plugins: [
      `build.onResolve({ filter: /\\.md\\?text$/ }, (args: any) => ({ path: join(args.resolveDir, args.path) }));
build.onLoad({ filter: /\\.md\\?text$/ }, () => ({ contents: "made by the plugin", loader: "text" }));`,
    ],
    differs: { exitCode: 0, stdout: "made by the plugin true\n" },
  },
  "import() of names made at run time that are the paths of texts of a plugin under queries": {
    files: {
      "main.ts": `// @ts-nocheck
import a from "./icon.svg?raw";
import b from "./icon.svg?inline";
import c from "./icon.svg?text";
import d from "./part.js?raw";
import e from "./part.js?text";
const which = name => String(globalThis.nothing ?? name);
for (const [file, query, written] of [["./icon.svg", "raw", a], ["./icon.svg", "inline", b], ["./icon.svg", "text", c], ["./part.js", "raw", d], ["./part.js", "text", e]]) {
  const name = [file, which(query)].join("?");
  console.log("composed " + name, await import(name).then(found => found.default === written, error => error.code));
}
console.log("template ./icon.svg?raw", await import(\`./\${which("icon")}.svg?raw\`).then(found => found.default === a, error => error.code));
console.log("template ./icon.svg?inline", await import(\`./\${which("icon")}.svg?inline\`).then(found => found.default === b, error => error.code));
console.log("template ./icon.svg?text", await import(\`./\${which("icon")}.svg?text\`).then(found => found.default === c, error => error.code));
console.log("template ./part.js?raw", await import(\`./\${which("part")}.js?raw\`).then(found => found.default === d, error => error.code));
console.log("template ./part.js?text", await import(\`./\${which("part")}.js?text\`).then(found => found.default === e, error => error.code));
console.log("written", (await import("./icon.svg?raw")).default === a, a);`,
      "icon.svg": "<svg>on the disk</svg>",
      "part.js": "export default 'on the disk';",
    },
    plugins: [
      `build.onResolve({ filter: /\\.(svg|js)\\?(raw|inline|text)$/ }, (args: any) => ({ path: join(args.resolveDir, args.path) }));
build.onLoad({ filter: /\\.(svg|js)\\?(raw|inline|text)$/ }, (args: any) => ({ contents: "made of " + basename(args.path), loader: "text" }));`,
    ],
    differs: {
      exitCode: 0,
      stdout:
        "composed ./icon.svg?raw true\ncomposed ./icon.svg?inline true\ncomposed ./icon.svg?text true\ncomposed ./part.js?raw true\ncomposed ./part.js?text true\ntemplate ./icon.svg?raw true\ntemplate ./icon.svg?inline true\ntemplate ./icon.svg?text true\ntemplate ./part.js?raw true\ntemplate ./part.js?text true\nwritten true made of icon.svg?raw\n",
    },
  },
  "require() of names made at run time that are the paths of texts of a plugin under queries": {
    files: {
      "main.cjs": `const which = name => String(globalThis.nothing ?? name);
const textOf = found => (typeof found === "string" ? found : found.default);
const a = require("./icon.svg?raw");
const b = require("./icon.svg?inline");
const c = require("./icon.svg?text");
const d = require("./part.js?raw");
const e = require("./part.js?text");
const outcome = (name, written) => {
  try {
    return textOf(require(name)) === textOf(written);
  } catch (error) {
    return error.code;
  }
};
for (const [file, query, written] of [["./icon.svg", "raw", a], ["./icon.svg", "inline", b], ["./icon.svg", "text", c], ["./part.js", "raw", d], ["./part.js", "text", e]]) {
  const name = [file, which(query)].join("?");
  console.log("composed " + name, outcome(name, written));
}
console.log("written", textOf(require("./icon.svg?raw")) === textOf(a), textOf(a));`,
      "icon.svg": "<svg>on the disk</svg>",
      "part.js": "exports.value = 'on the disk';",
    },
    options: `entrypoints: ["./main.cjs"]`,
    plugins: [
      `build.onResolve({ filter: /\\.(svg|js)\\?(raw|inline|text)$/ }, (args: any) => ({ path: join(args.resolveDir, args.path) }));
build.onLoad({ filter: /\\.(svg|js)\\?(raw|inline|text)$/ }, (args: any) => ({ contents: "made of " + basename(args.path), loader: "text" }));`,
    ],
    differs: {
      exitCode: 0,
      stdout:
        "composed ./icon.svg?raw true\ncomposed ./icon.svg?inline true\ncomposed ./icon.svg?text true\ncomposed ./part.js?raw true\ncomposed ./part.js?text true\nwritten true made of icon.svg?raw\n",
    },
  },
  "import() of a name made at run time that is the path of code of a plugin under a query": {
    files: {
      "main.ts": `// @ts-nocheck
import written from "./icon.svg?url";
const name = ["./icon.svg", String(globalThis.nothing ?? "url")].join("?");
console.log(written, await import(name).then(found => found.default === written, error => error.code));`,
      "icon.svg": "<svg>on the disk</svg>",
    },
    plugins: [
      `build.onResolve({ filter: /\\.svg\\?url$/ }, (args: any) => ({ path: join(args.resolveDir, args.path) }));
build.onLoad({ filter: /\\.svg\\?url$/ }, () => ({ contents: "export default 'made by the plugin'", loader: "js" }));`,
    ],
    differs: { exitCode: 0, stdout: "made by the plugin true\n" },
  },
  "require() behind import() of a name made at run time that is the path of data of a plugin under a query": {
    files: {
      "main.ts": `// @ts-nocheck
import { createRequire } from "node:module";
import * as text from "./one.txt?json";
import * as code from "./notes.js?a&b=1";
const load = createRequire(import.meta.url);
const which = name => String(globalThis.nothing ?? name);
const values = [JSON.stringify(text.default), JSON.stringify(code.default)];
for (const [index, name] of [{ one: "./one.txt?json" }[which("one")], ["nothing", ".js?a&b=1"].map(end => "./notes" + end)[Number(which("1"))]].entries()) {
  const imported = await import(name).then(found => JSON.stringify(found.default), error => error.code);
  const required = JSON.stringify(load(name).default);
  console.log(name, imported === values[index], required === values[index]);
}
const outcome = async name => [await import(name).then(found => JSON.stringify(found.default), error => error.code), JSON.stringify(load(name).default)];
console.log(await outcome(\`./one.txt?\${which("json")}\`).then(found => found.every(value => value === values[0]), error => error.code));
console.log(await outcome(["./notes.js", which("a&b=1")].join("?")).then(found => found.every(value => value === values[1]), error => error.code));`,
      "one.txt": "on the disk",
      "notes.js": "export default 'on the disk';",
    },
    plugins: [
      `build.onResolve({ filter: /\\?(json|a&b=1)$/ }, (args: any) => ({ path: join(args.resolveDir, args.path) }));
build.onLoad({ filter: /\\?(json|a&b=1)$/ }, (args: any) => ({ contents: JSON.stringify({ made: basename(args.path) }), loader: "json" }));`,
    ],
    differs: {
      exitCode: 0,
      stdout: "./one.txt?json true true\n./notes.js?a&b=1 true true\ntrue\ntrue\n",
    },
  },
  "a file is imported under a type and under a query that spells the type": {
    files: {
      "main.ts": `// @ts-nocheck
import text from "./part.mjs" with { type: "text" };
const made = "./part.mjs?" + ["te", "xt"].join("");
console.log(typeof text, (await import(made)).value);`,
      "part.mjs": `export const value = 1;`,
    },
    refused: "two modules have the path",
  },
  "a query string that a plugin takes": {
    files: {
      "main.ts": `// @ts-nocheck\nimport raw from "./code.ts?raw"; import { value } from "./code.ts"; import again from "./code.ts?raw"; console.log(JSON.stringify(raw), value, raw === again);`,
      "code.ts": `export const value: number = 1;`,
    },
    plugins: [
      `build.onResolve({ filter: /\\?raw$/ }, (args: any) => { tell("onResolve", args); return { path: join(args.resolveDir, args.path.slice(0, -4) + ".raw"), namespace: "raw" }; });
build.onLoad({ filter: /.*/, namespace: "raw" }, async (args: any) => { tell("onLoad", args); return { contents: await Bun.file(args.path.slice(0, -4)).text(), loader: "text" }; });`,
    ],
    prints: `"export const value: number = 1;" 1 true\n`,
  },
  "the loader of a module in a namespace goes by the extension in its path": {
    files: {
      "main.ts": `// @ts-nocheck\nimport json from "virtual:data.json"; import text from "virtual:note.txt"; import { typed } from "virtual:code.ts"; import toml from "virtual:nested/settings.toml"; console.log(json.n, text, typed, toml.n);`,
    },
    plugins: [
      `${virtual}
const contents: Record<string, string> = { "data.json": '{ "n": 1 }', "note.txt": "text", "code.ts": "export const typed: string = 'typed';", "nested/settings.toml": "n = 2" };
build.onLoad({ filter: /.*/, namespace: "virtual" }, (args: any) => { tell("onLoad", args); return { contents: contents[args.path] }; });`,
    ],
    prints: "1 text typed 2\n",
  },
  "names that are no file names": {
    files: {
      "main.ts": `// @ts-nocheck
import a from "virtual:with space"; import b from "virtual:UPPER/lower"; import c from "virtual:upper/LOWER"; import d from "virtual:ünï/código"; import e from "virtual:a%2fb"; import f from "virtual:a/b"; import g from "virtual:.."; import h from "virtual:a//b"; import i from "virtual:#hash?query"; import j from "virtual:C:\\\\x";
console.log([a, b, c, d, e, f, g, h, i, j].join("|"));`,
    },
    plugins: [
      `${virtual}\nbuild.onLoad({ filter: /.*/, namespace: "virtual" }, (args: any) => { tell("onLoad", args); return { contents: "export default " + JSON.stringify(args.path) + ";", loader: "js" }; });`,
    ],
    prints: "with space|UPPER/lower|upper/LOWER|ünï/código|a%2fb|a/b|..|a//b|#hash?query|C:\\x\n",
  },
  "a very long name": {
    files: {
      "main.ts": `// @ts-nocheck\nimport length from "virtual:${"long/".repeat(200)}${"x".repeat(400)}"; console.log(length);`,
    },
    plugins: [
      `${virtual}\nbuild.onLoad({ filter: /.*/, namespace: "virtual" }, (args: any) => ({ contents: "export default " + args.path.length + ";", loader: "js" }));`,
    ],
    prints: "1400\n",
  },
  "every way to import and to export again a module in a namespace": {
    alone: true,
    files: {
      "main.ts": `// @ts-nocheck
import fallback, { a, b as renamed } from "virtual:lib"; import * as all from "virtual:lib"; import { a as again, other, everything } from "./again"; const required = require("virtual:lib"); const late = await import("virtual:lib");
const key = "a"; console.log(fallback, a, renamed, all[key], Object.keys(all).sort().join(), again, other, everything.b, required.a, late.default, late === all);`,
      "again.ts": `// @ts-nocheck\nexport * from "virtual:lib"; export { default as other } from "virtual:lib"; export * as everything from "virtual:lib";`,
    },
    plugins: [
      `${virtual}\nlet loads = 0; build.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({ contents: "export const a = 'a" + ++loads + "', b = 'b'; export default 'fallback';", loader: "js" }));`,
    ],
  },
  "a data: URL": {
    files: {
      "main.ts": `// @ts-nocheck\nimport text from "data:text/plain,plain"; import { n } from "data:text/javascript,export const n = 1;"; console.log(text, n);`,
    },
    plugins: [`build.onResolve({ filter: /^data:/ }, (args: any) => void tell("onResolve", args));`],
    interprets: true,
  },
  "a package behind a symbolic link": {
    files: {
      "main.ts": `import { name } from "linked"; console.log(name);`,
      "types.d.ts": `declare module "linked" { export const name: string; }`,
      "store/linked/package.json": `{ "name": "linked", "version": "1.0.0", "main": "./index.js" }`,
      "store/linked/index.js": `exports.name = "linked " + require("./inner").inner + " " + require("peer").peer;`,
      "store/linked/inner.js": `exports.inner = "inner";`,
      "store/node_modules/peer/package.json": `{ "name": "peer", "version": "1.0.0", "main": "./index.js" }`,
      "store/node_modules/peer/index.js": `exports.peer = "peer of the store";`,
      "node_modules/peer/package.json": `{ "name": "peer", "version": "1.0.0", "main": "./index.js" }`,
      "node_modules/peer/index.js": `exports.peer = "peer of the project";`,
    },
    plugins: [
      `require("fs").rmSync(join(folder, "node_modules/linked"), { force: true }); require("fs").symlinkSync(join(folder, "store/linked"), join(folder, "node_modules/linked"), "junction");
build.onResolve({ filter: /.*/ }, (args: any) => void tell("onResolve", args));
build.onLoad({ filter: /.*/ }, (args: any) => void tell("onLoad", args));`,
    ],
  },
  "onLoad by the path behind a symbolic link": {
    files: {
      "main.ts": `import { name } from "linked"; console.log(name);`,
      "types.d.ts": `declare module "linked" { export const name: string; }`,
      "store/linked/package.json": `{ "name": "linked", "version": "1.0.0", "main": "./index.js" }`,
      "store/linked/index.js": `exports.name = "disk";`,
      "node_modules/.keep": "",
    },
    plugins: [
      `require("fs").rmSync(join(folder, "node_modules/linked"), { force: true }); require("fs").symlinkSync(join(folder, "store/linked"), join(folder, "node_modules/linked"), "junction");
build.onLoad({ filter: /store[\\\\/]linked[\\\\/]index\\.js$/ }, () => ({ contents: 'exports.name = "by the real path";', loader: "js" }));
build.onLoad({ filter: /node_modules[\\\\/]linked[\\\\/]index\\.js$/ }, () => ({ contents: 'exports.name = "by the path of the link";', loader: "js" }));`,
    ],
  },
});
