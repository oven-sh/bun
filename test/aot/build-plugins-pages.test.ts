// HTML pages, style sheets and other files that an executable carries, and the plugins of `Bun.build`, with `compile: { aot: true }`
// and without `aot`: build-both-ways.ts.
import { buildBothWays } from "./build-both-ways";

const types = `declare module "*.html" { const page: any; export default page; } declare const Bun: any;`;

// Serves the page, and prints what is asked of the page and of the script and the style sheet that it names.
const serve = (specifier: string, questions: string) => `// @ts-ignore
import page from ${JSON.stringify(specifier)};
const server = Bun.serve({ port: 0, routes: { "/": page } });
const html: string = await (await fetch(server.url)).text();
const get = async (pattern: RegExp) => { const found = pattern.exec(html); return found ? await (await fetch(new URL(found[1], server.url))).text() : "none"; };
const script = await get(/<script[^>]* src="([^"]+)"/), style = await get(/<link[^>]* href="([^"]+)"/);
console.log(${questions});
server.stop(true);`;

buildBothWays("compile/aot/pages and files of an executable, and the plugins of Bun.build", {
  "a page without plugins": {
    files: {
      "main.ts": serve(
        "./page.html",
        `html.includes("<h1>disk</h1>"), script.includes("client on the disk"), style.includes("red")`,
      ),
      "types.d.ts": types,
      "page.html": `<!doctype html><html><head><link rel="stylesheet" href="./style.css"><script type="module" src="./client.ts"></script></head><body><h1>disk</h1></body></html>`,
      "client.ts": `console.log("client on the disk");`,
      "style.css": `body { color: red }`,
    },
    prints: "true true true\n",
  },
  "onLoad changes the script and the style sheet of a page": {
    files: {
      "main.ts": serve(
        "./page.html",
        `script.includes("client from the plugin"), script.includes("client on the disk"), style.includes("from-the-plugin"), style.includes("on-the-disk")`,
      ),
      "types.d.ts": types,
      "page.html": `<!doctype html><html><head><link rel="stylesheet" href="./style.css"><script type="module" src="./client.ts"></script></head><body><h1>disk</h1></body></html>`,
      "client.ts": `console.log("client on the disk");`,
      "style.css": `.on-the-disk { color: red }`,
    },
    plugins: [
      `build.onLoad({ filter: /client\\.ts$/ }, (args: any) => { tell("onLoad", args); return { contents: 'console.log("client from the plugin");', loader: "ts" }; });
build.onLoad({ filter: /style\\.css$/ }, (args: any) => { tell("onLoad", args); return { contents: ".from-the-plugin { color: blue }", loader: "css" }; });`,
    ],
    prints: "true false true false\n",
  },
  "what plugins are told about a page and what it names": {
    files: {
      "main.ts": serve("./page.html", `html.includes("<h1>disk</h1>")`),
      "types.d.ts": types,
      "page.html": `<!doctype html><html><head><link rel="stylesheet" href="./style.css"><script type="module" src="./client.ts"></script></head><body><h1>disk</h1></body></html>`,
      "client.ts": `import { shared } from "./shared"; console.log("client", shared);`,
      "shared.ts": `export const shared = "shared";`,
      "style.css": `body { color: red }`,
    },
    plugins: [
      `build.onResolve({ filter: /^\\.\\/(client|shared|style)/ }, (args: any) => void tell("onResolve", args));\nbuild.onLoad({ filter: /\\.(ts|css)$/ }, (args: any) => void tell("onLoad", args));`,
    ],
    prints: "true\n",
  },
  "a file that the server and the page import": {
    files: {
      "main.ts":
        `import { shared } from "./shared";\n` +
        serve("./page.html", `shared, script.includes("shared from the plugin")`),
      "types.d.ts": types,
      "page.html": `<!doctype html><html><head><script type="module" src="./client.ts"></script></head><body></body></html>`,
      "client.ts": `import { shared } from "./shared"; console.log("client", shared);`,
      "shared.ts": `export const shared: string = "shared on the disk";`,
    },
    plugins: [
      `build.onLoad({ filter: /shared\\.ts$/ }, (args: any) => { tell("onLoad", args); return { contents: 'export const shared: string = "shared from the plugin for the ' + args.side + '";', loader: "ts" }; });`,
    ],
  },
  "onLoad changes the page itself": {
    files: {
      "main.ts": serve("./page.html", `html.includes("<h1>plugin</h1>"), html.includes("<h1>disk</h1>")`),
      "types.d.ts": types,
      "page.html": `<!doctype html><html><body><h1>disk</h1></body></html>`,
    },
    plugins: [
      `build.onLoad({ filter: /page\\.html$/ }, (args: any) => { tell("onLoad", args); return { contents: "<!doctype html><html><body><h1>plugin</h1></body></html>", loader: "html" }; });`,
    ],
    prints: "true false\n",
  },
  "a page in a namespace": {
    files: { "main.ts": serve("virtual:page.html", `html.includes("<h1>virtual</h1>")`), "types.d.ts": types },
    plugins: [
      `build.onResolve({ filter: /^virtual:/ }, (args: any) => ({ path: args.path.slice(8), namespace: "virtual" }));
build.onLoad({ filter: /.*/, namespace: "virtual" }, (args: any) => { tell("onLoad", args); return { contents: "<!doctype html><html><body><h1>virtual</h1></body></html>", loader: "html" }; });`,
    ],
    fails: "page.html",
  },
  "a page that becomes text": {
    files: {
      "main.ts": `import page from "./page.html"; console.log(typeof page, Object.keys(page).join());`,
      "types.d.ts": types,
      "page.html": `<h1>disk</h1>`,
    },
    plugins: [`build.onLoad({ filter: /page\\.html$/ }, () => ({ contents: "only text", loader: "text" }));`],
  },
  "the loaders file, wasm and sqlite": {
    files: {
      "main.ts": `// @ts-nocheck
import file from "virtual:data.bin"; import wasm from "virtual:add.wasm"; import db from "virtual:rows.db";
const { instance } = await WebAssembly.instantiate(await Bun.file(wasm).arrayBuffer());
console.log(await Bun.file(file).text(), typeof wasm, instance.exports.add(2, 3), JSON.stringify(db.query("select n from rows order by n").all()));`,
    },
    plugins: [
      `build.onResolve({ filter: /^virtual:/ }, (args: any) => ({ path: args.path.slice(8), namespace: "virtual" }));
build.onLoad({ filter: /\\.bin$/, namespace: "virtual" }, () => ({ contents: "bytes of a file", loader: "file" }));
build.onLoad({ filter: /\\.wasm$/, namespace: "virtual" }, () => ({ contents: new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 7, 1, 96, 2, 127, 127, 1, 127, 3, 2, 1, 0, 7, 7, 1, 3, 97, 100, 100, 0, 0, 10, 9, 1, 7, 0, 32, 0, 32, 1, 106, 11]), loader: "wasm" }));
build.onLoad({ filter: /\\.db$/, namespace: "virtual" }, () => { const { Database } = require("bun:sqlite"); const db = new Database(":memory:"); db.run("create table rows (n integer)"); db.run("insert into rows values (1), (2)"); return { contents: db.serialize(), loader: "sqlite_embedded" }; });`,
    ],
  },
  "files on the disk with the loaders file, wasm and sqlite, which onLoad replaces": {
    files: {
      "main.ts": `// @ts-nocheck
import file from "./data.bin" with { type: "file" }; import db from "./rows.db" with { type: "sqlite", embed: "true" };
console.log(await Bun.file(file).text(), JSON.stringify(db.query("select n from rows order by n").all()));`,
      "data.bin": "disk",
      "rows.db": "",
    },
    plugins: [
      `build.onLoad({ filter: /\\.bin$/ }, (args: any) => { tell("onLoad", args); return { contents: "plugin", loader: "file" }; });
build.onLoad({ filter: /\\.db$/ }, (args: any) => { tell("onLoad", args); const { Database } = require("bun:sqlite"); const db = new Database(":memory:"); db.run("create table rows (n integer)"); db.run("insert into rows values (7)"); return { contents: db.serialize(), loader: "sqlite_embedded" }; });`,
    ],
  },
  "a style sheet that the server imports": {
    files: {
      "main.ts": `// @ts-nocheck\nimport style from "./style.css"; console.log(typeof style);`,
      "style.css": `body { color: red }`,
    },
    plugins: [
      `build.onLoad({ filter: /\\.css$/ }, (args: any) => { tell("onLoad", args); return { contents: "body { color: blue }", loader: "css" }; });`,
    ],
  },
  "the loaders base64 and dataurl": {
    files: {
      "main.ts": `// @ts-nocheck\nimport a from "virtual:a"; import b from "virtual:b.txt"; console.log(a, b);`,
    },
    plugins: [
      `build.onResolve({ filter: /^virtual:/ }, (args: any) => ({ path: args.path.slice(8), namespace: "virtual" }));
build.onLoad({ filter: /^a$/, namespace: "virtual" }, () => ({ contents: "base", loader: "base64" }));
build.onLoad({ filter: /^b/, namespace: "virtual" }, () => ({ contents: "data", loader: "dataurl" }));`,
    ],
  },
  "the loaders md and xml": {
    files: {
      "main.ts": `// @ts-nocheck\nimport md from "virtual:a"; import xml from "virtual:b"; console.log(JSON.stringify(md), JSON.stringify(xml));`,
    },
    plugins: [
      `build.onResolve({ filter: /^virtual:/ }, (args: any) => ({ path: args.path.slice(8), namespace: "virtual" }));
build.onLoad({ filter: /^a$/, namespace: "virtual" }, () => ({ contents: "# title", loader: "md" }));
build.onLoad({ filter: /^b$/, namespace: "virtual" }, () => ({ contents: "<a n='1'><b>t</b></a>", loader: "xml" }));`,
    ],
  },
});
