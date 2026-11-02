// Files that an executable carries as they are: a shared library, a sound, a file of a kind that nothing names. With `compile: { aot: true }` and without `aot`: build-both-ways.ts.
// Whichever way the program asks for such a file, it gets the path of the file in the executable, and nothing reads the file as code.
import { buildBothWays } from "./build-both-ways";

const library = "\x7fELF\x02\x01\x01\0\0\0\0\0\0\0\0\0\x03\0>\0\x01\0\0\0(\0)\0,\n\0`${\0'\"\0/*\0";
const show = `async function show(path: unknown) { return typeof path + " " + (await Bun.file(path as string).bytes()).length; }`;

buildBothWays("compile/aot/files that are no code", {
  "require of a shared library": {
    files: {
      "main.ts": `${show}
console.log(await show(require("./native/library.so")));`,
      "native/library.so": library,
    },
    prints: `string ${library.length}\n`,
  },
  "require of the one library that fits the platform": {
    files: {
      "main.ts": `${show}
function find(): string | undefined {
  try {
    return require(\`./native/\${process.platform === "win32" ? "library.dll" : process.platform === "darwin" ? "library.dylib" : "library.so"}\`);
  } catch {}
}
console.log(await show(find()));`,
      "native/library.so": library,
      "native/library.dll": library,
      "native/library.dylib": library,
    },
    prints: `string ${library.length}\n`,
  },
  "require in a package, in JavaScript and in TypeScript": {
    files: {
      "main.ts": `import { path as typed } from "typed";
import { path as untyped } from "untyped";
${show}
console.log(await show(typed), await show(untyped));`,
      "node_modules/typed/package.json": `{ "name": "typed", "version": "1.0.0", "main": "./index.ts" }`,
      "node_modules/typed/index.ts": `export const path: string = require("./library.so");`,
      "node_modules/typed/library.so": library,
      "node_modules/untyped/package.json": `{ "name": "untyped", "version": "1.0.0", "main": "./index.js", "types": "./index.d.ts" }`,
      "node_modules/untyped/index.js": `exports.path = require("./library.so");`,
      "node_modules/untyped/index.d.ts": `export const path: string;`,
      "node_modules/untyped/library.so": library,
    },
    prints: `string ${library.length} string ${library.length}\n`,
  },
  "import, import() and require of one file": {
    files: {
      "main.ts": `// @ts-ignore
import imported from "./library.so";
${show}
// @ts-ignore
const later = await import("./library.so");
console.log(await show(imported), imported === require("./library.so"), imported === later.default);`,
      "library.so": library,
    },
    prints: `string ${library.length} true true\n`,
  },
  "a shared library whose name has no extension": {
    files: {
      "main.ts": `// @ts-ignore
import imported from "./native/library";
${show}
console.log(await show(imported), imported === require("./native/library"));`,
      "native/library": library,
    },
    prints: `string ${library.length} true\n`,
  },
  "text of a kind that nothing names": {
    files: {
      "main.ts": `${show}
console.log(await show(require("./notes.unknown")));`,
      "notes.unknown": `module.exports = { read: "as code" };`,
    },
    prints: "string 37\n",
  },
  'with { type: "file" } on code': {
    files: {
      "main.ts": `import path from "./worker.ts" with { type: "file" };
${show}
const text: string = path;
console.log(await show(text));`,
      "worker.ts": `const wrong: number = "not checked";\nthis is no code`,
    },
    prints: "string 52\n",
  },
  "the loader option names the file loader": {
    files: {
      "main.ts": `// @ts-ignore
import path from "./table.json";
${show}
console.log(await show(path), await show(require("./table.json")));`,
      "table.json": `{ not json`,
    },
    options: `loader: { ".json": "file" }`,
    prints: "string 10 string 10\n",
  },
  "a plugin answers the file loader for code": {
    files: {
      "main.ts": `// @ts-ignore
import path from "./carried.ts";
${show}
console.log(await show(path));`,
      "carried.ts": `export default 1;`,
    },
    plugins: [
      `build.onLoad({ filter: /carried\\.ts$/ }, () => ({ contents: ${JSON.stringify(library)}, loader: "file" }));`,
    ],
    prints: `string ${library.length}\n`,
  },
});
