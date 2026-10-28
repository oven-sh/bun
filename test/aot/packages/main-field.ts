// "main" in all its forms (without an extension, a folder, a missing file, JSON, none at all), "browser", a package.json in a subfolder, scoped packages.
import { pkg, ways, type Case } from "./run-packages";

// The files of a package, each of which exports its own name as `which`, and what goes into package.json.
const layouts: Record<string, [Record<string, string>, Record<string, unknown>]> = {
  "no-extension": [
    {
      "lib/index.js": `exports.which = "lib/index.js";
exports.f = function f() { return "f of " + exports.which; };
`,
    },
    {"main": "lib/index"},
  ],
  folder: [
    {
      "lib/index.js": `exports.which = "lib/index.js";
exports.f = function f() { return "f of " + exports.which; };
`,
    },
    {"main": "lib"},
  ],
  "folder-slash": [
    {
      "lib/index.js": `exports.which = "lib/index.js";
exports.f = function f() { return "f of " + exports.which; };
`,
    },
    {"main": "./lib/"},
  ],
  none: [
    {
      "index.js": `exports.which = "index.js";
exports.f = function f() { return "f of " + exports.which; };
`,
    },
    {},
  ],
  "missing-file": [
    {
      "index.js": `exports.which = "index.js";
exports.f = function f() { return "f of " + exports.which; };
`,
    },
    {"main": "./gone.js"},
  ],
  dot: [
    {
      "index.js": `exports.which = "index.js";
exports.f = function f() { return "f of " + exports.which; };
`,
    },
    {"main": "."},
  ],
  "file-and-folder": [
    {
      "dist/index.js": `exports.which = "dist/index.js";
exports.f = function f() { return "f of " + exports.which; };
`,
      "dist/index/index.js": `exports.which = "dist/index/index.js";
exports.f = function f() { return "f of " + exports.which; };
`,
    },
    {"main": "./dist/index"},
  ],
  "js-and-json": [
    {
      "lib/x.js": `exports.which = "lib/x.js";
exports.f = function f() { return "f of " + exports.which; };
`,
      "lib/x.json": `{ "which": "lib/x.json" }`,
    },
    {"main": "lib/x"},
  ],
  json: [
    {
      "data.json": `{ "which": "data.json", "f": 1 }`,
    },
    {"main": "data.json"},
  ],
  "cjs-ext": [
    {
      "lib/i.cjs": `exports.which = "lib/i.cjs";
exports.f = function f() { return "f of " + exports.which; };
`,
    },
    {"main": "lib/i.cjs"},
  ],
  "mjs-ext": [
    {
      "lib/i.mjs": `export const which = "lib/i.mjs";
export function f() { return "f of " + which; }
`,
    },
    {"main": "lib/i.mjs"},
  ],
  "index-mjs-only": [
    {
      "index.mjs": `export const which = "index.mjs";
export function f() { return "f of " + which; }
`,
    },
    {},
  ],
  "index-json-only": [
    {
      "index.json": `{ "which": "index.json", "f": 1 }`,
    },
    {},
  ],
  "nested-package-json": [
    {
      "index.js": `exports.which = "index.js";
exports.f = function f() { return "f of " + exports.which; };
`,
      "sub/package.json": `{ "main": "../lib/real.js" }`,
      "lib/real.js": `exports.which = "lib/real.js";
exports.f = function f() { return "f of " + exports.which; };
`,
    },
    {"main": "index.js"},
  ],
  "browser-string": [
    {
      "node.js": `exports.which = "node.js";
exports.f = function f() { return "f of " + exports.which; };
`,
      "browser.js": `exports.which = "browser.js";
exports.f = function f() { return "f of " + exports.which; };
`,
    },
    {"main": "node.js", "browser": "browser.js"},
  ],
  "browser-map": [
    {
      "index.js": `const i = require("./impl.js");
let fs; try { fs = typeof require("fs").readFileSync; } catch (e) { fs = e.name; }
exports.which = i.which + " fs " + fs;
exports.f = i.f;
`,
      "impl.js": `exports.which = "impl.js";
exports.f = function f() { return "f of " + exports.which; };
`,
      "impl-browser.js": `exports.which = "impl-browser.js";
exports.f = function f() { return "f of " + exports.which; };
`,
    },
    {"main": "index.js", "browser": {"./impl.js": "./impl-browser.js", "fs": false}},
  ],
  "ts-source": [
    {
      "src/index.ts": `export const which: string = "src/index.ts";
export function f(): string { return "f of " + which; }
`,
    },
    {"main": "src/index.ts"},
  ],
  "esm-in-js-no-type": [
    {
      "index.js": `export const which = "index.ESM text, no type";
export function f() { return "f of " + which; }
`,
    },
    {"main": "index.js"},
  ],
  "cjs-in-type-module": [
    {
      "index.js": `exports.which = "index.js, CommonJS text, type module";
exports.f = function f() { return "f of " + exports.which; };
`,
    },
    {"main": "index.js", "type": "module"},
  ],
};

const some = { hasDefault: false, typed: false, only: ["names.mjs", "namespace.mjs", "dynamic-import.mjs", "require.cjs"] };
const declarations = `export declare const which: string;\nexport declare function f(): string;\n`;
const commonjs = (which: string) => `exports.which = "${which}";\nexports.f = function f() { return "f of " + exports.which; };\n`;

export const cases: Case[] = [
  ...Object.entries(layouts).map(([name, [files, packageJson]]) => {
    const packageName = "m_" + name.replaceAll("-", "_");
    return {
      name,
      files: pkg(packageName, files, packageJson),
      importers: {
        ...ways(packageName, ["which", "f"], { ...some, tag: "x" }),
        ...(name === "nested-package-json" ? ways(packageName + "/sub", ["which", "f"], { hasDefault: false, typed: false, tag: "sub" }) : {}),
      },
    };
  }),
  {
    name: "scoped",
    files: pkg(
      "@scope/pk",
      { "index.js": commonjs("@scope/pk"), "index.d.ts": declarations, "deep/x.js": commonjs("@scope/pk/deep/x"), "deep/x.d.ts": declarations },
      { main: "index.js", types: "index.d.ts" },
    ),
    importers: {
      ...ways("@scope/pk", ["which", "f"], { hasDefault: false, tag: "x" }),
      ...ways("@scope/pk/deep/x", ["which", "f"], { hasDefault: false, tag: "deep" }),
      ...ways("@scope/pk/deep/x.js", ["which", "f"], { hasDefault: false, tag: "deepjs" }),
    },
  },
];
