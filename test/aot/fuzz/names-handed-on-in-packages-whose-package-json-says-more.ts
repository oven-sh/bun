// Small programs in which one name, `c`, lies in the last file of a package and reaches the program through one or two files of the package that hand it on, under a package.json that says one thing more
// than a name (`corners`).
//
//   package.json   "sideEffects" in seven forms; "main" with and without its ending, or a folder; "module" beside "main" and alone; "browser" as a text and as a map; "type"; "exports" as a text, with ".", with
//                  "import" and "require", with "bun", "node" and "default", nested, with a path below, with a pattern, beside a "main" that names another file; "imports"; a second package.json further down;
//                  the package.json of the project itself; a folder of the project that has one. Beside every other field "sideEffects": false is there in half of the programs
//   handed on by   getters as TypeScript, Babel, swc and esbuild emit them or as they are written by hand, their helpers for `export *`, stores, a pattern, a spread, `Object.assign`, `module.exports = require(..)`,
//                  getters in a literal; or an ES module: `export { } from`, `export * from`, an import that is exported
//   the last file  CommonJS (stores, a literal, as TypeScript emits it) or an ES module (`const`, `let`, `var`); the name holds an integer, a fraction, a text, an object, a function or a class, and `change`
//                  gives it another value where it can; in some programs the file has a member `default` too, with and without `__esModule`
//   taken          by name, as the namespace, as the default, by `require`, `import x = require(..)` or `import()`; straight or through one or two ES modules, which lie in the project or in the package
//   where `isWider`  the text of the last file does not show its names (computed keys, an object that a function makes, `Object.assign`, definitions in a loop); the second file has a `c` too, or comes first;
//                  the file that hands on has a name of its own; the helper for `export *` comes from the package tslib
//   beside it      a second file of the package whose name nobody takes; a second importer; a function that requires the last file when it is called; a last file that requires the first one back
//   declarations   for TypeScript a declaration file beside every file that can be entered: it says what the name is, a literal type, or another type
//
// A file of a package that says it has no side effects has none, but for the last file, whose name is always taken. Files tell that they ran in a list, which is printed sorted. The executable prints what
// plain Bun prints and ends as it ends.
import type { Random } from "./random";

export const corners = [
  "only a name",
  '"sideEffects": false',
  '"sideEffects": true',
  '"sideEffects": an empty list',
  '"sideEffects": the file that hands on',
  '"sideEffects": the last file',
  '"sideEffects": a pattern for every file',
  '"sideEffects": a pattern for no file',
  '"main"',
  '"main" without its ending',
  '"main": a folder',
  '"module" beside "main"',
  '"module" alone',
  '"browser" beside "main"',
  '"browser" replaces the last file',
  '"browser" removes the last file',
  '"type": "module"',
  '"type": "commonjs"',
  '"exports": a text',
  '"exports": "."',
  '"exports": "import" and "require"',
  '"exports": "bun", "node" and "default"',
  '"exports": nested',
  '"exports": a path below',
  '"exports": a pattern',
  '"exports" beside "main"',
  '"imports"',
  "a package.json further down",
  "the package.json of the project",
  "a folder of the project",
] as const;

const values = {
  "an integer": { first: "1", next: "11", type: "number", literal: "1", other: "string" },
  "a fraction": { first: "1.5", next: "2.25", type: "number", literal: "1.5", other: "string" },
  "a text": { first: '"text"', next: '"other"', type: "string", literal: '"text"', other: "number" },
  "an object": {
    first: "{ a: 1 }",
    next: "{ a: 2, b: 3 }",
    type: "{ a: number }",
    literal: "{ readonly a: 1 }",
    other: "{ a: string }",
  },
  "a function": {
    first: "function () {\n  return 1;\n}",
    next: "function () {\n  return 2;\n}",
    type: "() => number",
    literal: "() => 1",
    other: "() => string",
  },
  "a class": {
    first: "class {\n  a = 1;\n}",
    next: "class {\n  a = 2;\n}",
    type: "new () => { a: number }",
    literal: "new () => { readonly a: 1 }",
    other: "new () => { a: string }",
  },
} as const;
const uses = {
  "an integer": ["§", "§ + 1", "typeof §", "[§].length + String(§)"],
  "a fraction": ["§", "§ + 1", "typeof §", "[§].length + String(§)"],
  "a text": ["§", "§ + 1", "typeof §", "String(§).length"],
  "an object": ["§.a", "JSON.stringify(§)", "Object.keys(§).join()", "typeof §"],
  "a function": ["§()", "§() + 1", "typeof §"],
  "a class": ["new §().a", "new (class extends § {})().a", "typeof §"],
} as const;

type Source = { variable: string; names: string[]; below: string };
const mark = `Object.defineProperty(exports, "__esModule", { value: true });\n`;
const key = (name: string) => (name === "default" ? `["default"]` : `.${name}`);
const getters = (sources: Source[], variable: (source: Source) => string) =>
  sources
    .flatMap(source =>
      source.names.map(
        name =>
          `Object.defineProperty(exports, "${name}", { enumerable: true, get: function () { return ${variable(source)}.${name}; } });\n`,
      ),
    )
    .join("");
const all = (sources: Source[]) => sources.flatMap(source => source.names);

/** How a CommonJS file hands on the names of the files below it. */
const commonForms: Record<string, (sources: Source[]) => string> = {
  "getters by hand": sources =>
    sources.map(({ variable, below }) => `var ${variable} = require(${below});\n`).join("") +
    getters(sources, source => source.variable),
  "TypeScript, names": sources =>
    `"use strict";\n${mark}exports.${[...all(sources)].reverse().join(" = exports.")} = void 0;\n` +
    sources
      .map(
        source => `var ${source.variable}_1 = require(${source.below});\n${getters([source], s => `${s.variable}_1`)}`,
      )
      .join(""),
  "TypeScript, a star": sources =>
    `"use strict";\nvar __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {\n    if (k2 === undefined) k2 = k;\n    var desc = Object.getOwnPropertyDescriptor(m, k);\n    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {\n      desc = { enumerable: true, get: function() { return m[k]; } };\n    }\n    Object.defineProperty(o, k2, desc);\n}) : (function(o, m, k, k2) {\n    if (k2 === undefined) k2 = k;\n    o[k2] = m[k];\n}));\nvar __exportStar = (this && this.__exportStar) || function(m, exports) {\n    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);\n};\n${mark}` +
    sources.map(({ below }) => `__exportStar(require(${below}), exports);\n`).join(""),
  // As TypeScript emits it under `importHelpers`. Drawn only where `isWider`.
  "TypeScript with tslib, a star": sources =>
    `"use strict";\n${mark}const tslib_1 = require("tslib");\n` +
    sources.map(({ below }) => `tslib_1.__exportStar(require(${below}), exports);\n`).join(""),
  "Babel, names": sources =>
    `"use strict";\n\n${mark}${getters(sources, source => `_${source.variable}`)}` +
    sources.map(({ variable, below }) => `var _${variable} = require(${below});\n`).join(""),
  "Babel, a star": sources =>
    `"use strict";\n\n${mark}` +
    sources
      .map(
        ({ variable, below }) =>
          `var _${variable} = require(${below});\nObject.keys(_${variable}).forEach(function (key) {\n  if (key === "default" || key === "__esModule") return;\n  if (key in exports && exports[key] === _${variable}[key]) return;\n  Object.defineProperty(exports, key, {\n    enumerable: true,\n    get: function () {\n      return _${variable}[key];\n    }\n  });\n});\n`,
      )
      .join(""),
  "swc, names": sources =>
    `"use strict";\n${mark}function _export(target, all) {\n    for(var name in all)Object.defineProperty(target, name, {\n        enumerable: true,\n        get: Object.getOwnPropertyDescriptor(all, name).get\n    });\n}\n_export(exports, {\n` +
    sources
      .flatMap(({ variable, names }) =>
        names.map(name => `    get ${name} () {\n        return _${variable}.${name};\n    }`),
      )
      .join(",\n") +
    `\n});\n` +
    sources.map(({ variable, below }) => `const _${variable} = require(${below});\n`).join(""),
  "swc, a star": sources =>
    `"use strict";\n${mark}` +
    sources.map(({ below }) => `_export_star(require(${below}), exports);\n`).join("") +
    `function _export_star(from, to) {\n    Object.keys(from).forEach(function(k) {\n        if (k !== "default" && !Object.prototype.hasOwnProperty.call(to, k)) {\n            Object.defineProperty(to, k, {\n                enumerable: true,\n                get: function() {\n                    return from[k];\n                }\n            });\n        }\n    });\n    return from;\n}\n`,
  "esbuild, names": sources =>
    `"use strict";\nvar __defProp = Object.defineProperty;\nvar __getOwnPropDesc = Object.getOwnPropertyDescriptor;\nvar __getOwnPropNames = Object.getOwnPropertyNames;\nvar __hasOwnProp = Object.prototype.hasOwnProperty;\nvar __export = (target, all) => {\n  for (var name in all)\n    __defProp(target, name, { get: all[name], enumerable: true });\n};\nvar __copyProps = (to, from, except, desc) => {\n  if (from && typeof from === "object" || typeof from === "function") {\n    for (let key of __getOwnPropNames(from))\n      if (!__hasOwnProp.call(to, key) && key !== except)\n        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });\n  }\n  return to;\n};\nvar __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);\nvar index_exports = {};\n__export(index_exports, {\n` +
    sources
      .flatMap(({ variable, names }) => names.map(name => `  ${name}: () => import_${variable}.${name}`))
      .join(",\n") +
    `\n});\nmodule.exports = __toCommonJS(index_exports);\n` +
    sources.map(({ variable, below }) => `var import_${variable} = require(${below});\n`).join(""),
  "esbuild, a star": sources =>
    `"use strict";\nvar __defProp = Object.defineProperty;\nvar __getOwnPropDesc = Object.getOwnPropertyDescriptor;\nvar __getOwnPropNames = Object.getOwnPropertyNames;\nvar __hasOwnProp = Object.prototype.hasOwnProperty;\nvar __copyProps = (to, from, except, desc) => {\n  if (from && typeof from === "object" || typeof from === "function") {\n    for (let key of __getOwnPropNames(from))\n      if (!__hasOwnProp.call(to, key) && key !== except)\n        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });\n  }\n  return to;\n};\nvar __reExport = (target, mod, secondTarget) => (__copyProps(target, mod, "default"), secondTarget && __copyProps(secondTarget, mod, "default"));\nvar __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);\nvar index_exports = {};\nmodule.exports = __toCommonJS(index_exports);\n` +
    sources.map(({ below }) => `__reExport(index_exports, require(${below}), module.exports);\n`).join(""),
  stores: sources =>
    sources
      .map(
        ({ variable, names, below }) =>
          `var ${variable} = require(${below});\n${names.map(name => `exports${key(name)} = ${variable}${key(name)};\n`).join("")}`,
      )
      .join(""),
  "a pattern": sources =>
    sources
      .map(
        ({ names, below }) =>
          `const { ${names.map(name => (name === "default" ? "default: whole" : name)).join(", ")} } = require(${below});\n`,
      )
      .join("") +
    `module.exports = { ${all(sources)
      .map(name => (name === "default" ? "default: whole" : name))
      .join(", ")} };\n`,
  "a spread": sources => `module.exports = { ${sources.map(({ below }) => `...require(${below})`).join(", ")} };\n`,
  "Object.assign": sources => sources.map(({ below }) => `Object.assign(exports, require(${below}));\n`).join(""),
  "getters in a literal": sources =>
    sources.map(({ variable, below }) => `var ${variable} = require(${below});\n`).join("") +
    `module.exports = {\n` +
    sources
      .flatMap(({ variable, names }) =>
        names.map(name => `  get ${name}() {\n    return ${variable}${key(name)};\n  },\n`),
      )
      .join("") +
    `};\n`,
  "the whole": sources => `module.exports = require(${sources[0].below});\n`,
};

/** The package that TypeScript's helpers come from, cut to two helpers: its CommonJS file, its ES module and its package.json are written as the real ones are. */
const tslib = {
  "node_modules/tslib/package.json":
    JSON.stringify(
      {
        name: "tslib",
        version: "2.8.1",
        main: "tslib.js",
        module: "tslib.es6.js",
        sideEffects: false,
        exports: {
          ".": {
            module: "./tslib.es6.mjs",
            import: { node: "./modules/index.js", default: "./tslib.es6.mjs" },
            default: "./tslib.js",
          },
          "./*": "./*",
        },
      },
      null,
      2,
    ) + "\n",
  "node_modules/tslib/modules/package.json": `{ "type": "module" }\n`,
  "node_modules/tslib/modules/index.js": `import tslib from "../tslib.js";\nconst { __createBinding, __exportStar } = tslib;\nexport { __createBinding, __exportStar };\nexport default tslib;\n`,
  "node_modules/tslib/tslib.js": `var __createBinding;\nvar __exportStar;\n(function (factory) {\n    var root = typeof global === "object" ? global : typeof self === "object" ? self : typeof this === "object" ? this : {};\n    if (typeof define === "function" && define.amd) {\n        define("tslib", ["exports"], function (exports) { factory(createExporter(root, createExporter(exports))); });\n    }\n    else if (typeof module === "object" && typeof module.exports === "object") {\n        factory(createExporter(root, createExporter(module.exports)));\n    }\n    else {\n        factory(createExporter(root));\n    }\n    function createExporter(exports, previous) {\n        if (exports !== root) {\n            if (typeof Object.create === "function") {\n                Object.defineProperty(exports, "__esModule", { value: true });\n            }\n            else {\n                exports.__esModule = true;\n            }\n        }\n        return function (id, v) { return exports[id] = previous ? previous(id, v) : v; };\n    }\n})\n(function (exporter) {\n    __exportStar = function(m, o) {\n        for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(o, p)) __createBinding(o, m, p);\n    };\n\n    __createBinding = Object.create ? (function(o, m, k, k2) {\n        if (k2 === undefined) k2 = k;\n        var desc = Object.getOwnPropertyDescriptor(m, k);\n        if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {\n            desc = { enumerable: true, get: function() { return m[k]; } };\n        }\n        Object.defineProperty(o, k2, desc);\n    }) : (function(o, m, k, k2) {\n        if (k2 === undefined) k2 = k;\n        o[k2] = m[k];\n    });\n\n    exporter("__exportStar", __exportStar);\n    exporter("__createBinding", __createBinding);\n});\n`,
  "node_modules/tslib/tslib.es6.mjs": `export var __createBinding = Object.create ? (function(o, m, k, k2) {\n  if (k2 === undefined) k2 = k;\n  var desc = Object.getOwnPropertyDescriptor(m, k);\n  if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {\n      desc = { enumerable: true, get: function() { return m[k]; } };\n  }\n  Object.defineProperty(o, k2, desc);\n}) : (function(o, m, k, k2) {\n  if (k2 === undefined) k2 = k;\n  o[k2] = m[k];\n});\n\nexport function __exportStar(m, o) {\n  for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(o, p)) __createBinding(o, m, p);\n}\n\nexport default {\n  __createBinding,\n  __exportStar,\n};\n`,
};

/** How an ES module hands them on. */
const moduleForms: Record<string, (sources: Source[]) => string> = {
  "export { } from": sources =>
    sources.map(({ names, below }) => `export { ${names.join(", ")} } from ${below};\n`).join(""),
  "export * from": sources =>
    sources
      .map(
        ({ names, below }) =>
          `export * from ${below};\n${names.includes("default") ? `export { default } from ${below};\n` : ""}`,
      )
      .join(""),
  "an import that is exported": sources =>
    sources
      .map(
        ({ names, below }) =>
          `import { ${names.map(name => (name === "default" ? "default as whole" : name)).join(", ")} } from ${below};\n`,
      )
      .join("") +
    `export { ${all(sources)
      .map(name => (name === "default" ? "whole as default" : name))
      .join(", ")} };\n`,
};

export function generate(
  random: Random,
  corner: (typeof corners)[number],
  isJudgedAsAnExecutable = false,
  isWider = false,
): { file: string; text: string; files: Record<string, string> } {
  // The relations first.
  const kind = random.pick(Object.keys(values) as (keyof typeof values)[]);
  const value = values[kind];
  // Under `bun run` an import takes "main" there, in an executable "module": without `isJudgedAsAnExecutable` everything is required.
  const isOnlyRequired = corner === '"module" beside "main"' && !isJudgedAsAnExecutable;
  const ending = random.weighted([
    [isOnlyRequired ? 0 : 5, "mjs"],
    [isOnlyRequired ? 0 : 4, "ts"],
    [1, "cjs"],
  ] as const);
  const isTyped = ending === "ts";
  const says = random.weighted([
    [5, "type"],
    [2, "literal"],
    [2, "other"],
  ] as const);
  const hasDefault = random.chance(0.3);
  const hasMiddle = random.chance(0.3);
  const hasOther = random.chance(0.6);
  const last = random.weighted([
    [3, "stores"],
    [2, "a literal"],
    [2, "as TypeScript emits it"],
    [2, "const"],
    [3, "let"],
    [2, "var"],
  ] as const);
  const isLastMarked = last === "as TypeScript emits it" || (last === "stores" && random.chance(0.3));
  const isLastAModule = last === "const" || last === "let" || last === "var";
  const usesJs = random.chance(0.4);
  const quiet = random.weighted([
    [5, false],
    [3, undefined],
    [1, true],
  ] as const);
  const isScoped = random.chance(0.15);
  const side = random.weighted([
    [4, "none"],
    [isOnlyRequired ? 0 : 4, "export { } from"],
    [isOnlyRequired ? 0 : 3, "export * from"],
    [isOnlyRequired ? 0 : 1, "an import that is exported"],
    [isOnlyRequired ? 0 : 1, "a star of names"],
    [isOnlyRequired ? 0 : 1, "names of a star"],
  ] as const);
  const isBarrelInside = random.chance(0.3);
  const second = random.weighted([
    [6, "none"],
    [isOnlyRequired ? 0 : 1, "the other name"],
    [1, "the package is required"],
    [isOnlyRequired ? 0 : 1, "the same name"],
  ] as const);
  const lazyDrawn = random.weighted([
    [5, "none"],
    [1, "never called"],
    [1, "called"],
  ] as const);
  // `import.meta.require` is not the same thing in an executable that is built without --aot.
  const lazy = isJudgedAsAnExecutable ? "none" : lazyDrawn;
  const cycle = random.weighted([
    [7, "none"],
    [1, "the keys"],
    [1, "the name"],
  ] as const);
  const isBackToTheBarrel = random.chance(0.4);
  const isLoud = random.chance(0.6);
  const loops = random.chance(0.15);
  // What is drawn only where `isWider`: the earlier seeds stay as they are.
  const hidden =
    isWider && !isLastAModule
      ? random.weighted([
          [2, "shown"],
          [2, "computed keys"],
          [2, "made by a function"],
          [1, "Object.assign"],
          [1, "defined in a loop"],
        ] as const)
      : "shown";
  const isOtherAlike = isWider && random.chance(0.3);
  const isOtherFirst = isWider && random.chance(0.4);
  const hasAnOwnName = isWider && random.chance(0.3);

  const files: Record<string, string> = {};
  const inProject = corner === "the package.json of the project" || corner === "a folder of the project";
  const packageName = isScoped ? "@scope/a-package" : "a-package";
  const root =
    corner === "the package.json of the project"
      ? ""
      : corner === "a folder of the project"
        ? "p/"
        : `node_modules/${packageName}/`;
  const needsIndexJs =
    corner === "only a name" || corner === '"main" without its ending' || corner === '"main": a folder';
  const type =
    corner === '"type": "module"'
      ? "module"
      : corner === '"type": "commonjs"'
        ? "commonjs"
        : corner === "only a name" || corner.startsWith('"sideEffects"')
          ? undefined
          : random.weighted([
              [4, undefined],
              [1, "module"],
              [1, "commonjs"],
            ] as const);
  const endingOf = (isModule: boolean) =>
    type === "module"
      ? isModule
        ? "js"
        : "cjs"
      : isModule
        ? "mjs"
        : type === "commonjs" || usesJs || needsIndexJs
          ? "js"
          : "cjs";
  const folder =
    corner === "only a name"
      ? ""
      : corner === '"main": a folder' ||
          corner === "a package.json further down" ||
          corner === "the package.json of the project" ||
          corner === '"exports": a pattern' ||
          random.chance(0.4)
        ? "lib/"
        : "";

  // Which files of the package say that they have no side effects.
  const effects: unknown =
    corner === '"sideEffects": false'
      ? false
      : corner === '"sideEffects": true'
        ? true
        : corner === '"sideEffects": an empty list'
          ? []
          : corner === '"sideEffects": a pattern for every file'
            ? random.pick([["*.js", "*.cjs", "*.mjs"], ["**/*"], [`./${folder}*`]])
            : corner === '"sideEffects": a pattern for no file'
              ? random.pick([["*.css"], ["./styles/*"], ["./other/index.js"]])
              : corner === '"sideEffects": the file that hands on' || corner === '"sideEffects": the last file'
                ? ["the file"]
                : corner === "only a name"
                  ? undefined
                  : quiet;
  const lastPath = `${folder}inner.${endingOf(isLastAModule)}`;
  const isEveryFileQuiet =
    effects === false || (Array.isArray(effects) && corner !== '"sideEffects": a pattern for every file');

  const names = ["c", "change", ...(hasDefault ? ["default"] : [])];
  const ran = (name: string) => `(globalThis.ran ??= []).push("${name}");\n`;
  const declared = value[says];
  const isConstant = last === "const";

  // The files that can be entered, each under the label it tells as `which`.
  const entries: string[] = [];
  let isEveryEntryCommonJS = true;
  const isLabeled =
    hasAnOwnName ||
    [
      '"module" beside "main"',
      '"browser" beside "main"',
      '"exports": "import" and "require"',
      '"exports": "bun", "node" and "default"',
      '"exports": nested',
      '"exports" beside "main"',
    ].includes(corner);
  const declarationOf = (path: string) => path.replace(/\.(c|m)?js$/, (_, letter) => `.d.${letter ?? ""}ts`);
  const declaration =
    `export declare ${isConstant ? "const" : "let"} c: ${declared};\nexport declare function change(): void;\n` +
    (hasOther ? "export declare const e: number;\n" : "") +
    (isLabeled ? "export declare const which: string;\n" : "") +
    (lazy !== "none" ? `export declare function lazy(): { c: ${declared} };\n` : "") +
    (hasDefault ? "declare const whole: string;\nexport default whole;\n" : "");
  const toLast = corner === '"imports"' ? `"#inner"` : undefined;
  const beside = (path: string) => JSON.stringify(`./${path.slice(folder.length)}`);
  const hands = (name: string, wantsAModule: boolean | undefined, label: string, isFirst: boolean, below: string) => {
    const isModule = wantsAModule ?? (needsIndexJs && isFirst ? type === "module" : random.chance(0.3));
    const sources: Source[] = [
      { variable: "inner", names, below },
      ...(isFirst && hasOther ? [{ variable: "other", names: ["e"], below: `"./other.${endingOf(false)}"` }] : []),
    ];
    if (isOtherFirst) sources.reverse();
    const forms = isModule ? moduleForms : commonForms;
    const form =
      isWider && !isModule && random.chance(0.25)
        ? "TypeScript with tslib, a star"
        : random.pick(
            Object.keys(forms).filter(
              form =>
                !form.includes("tslib") &&
                (form !== "the whole" || (sources.length === 1 && !isLabeled && lazy === "none")),
            ),
          );
    const path = `${folder}${name}.${endingOf(isModule)}`;
    const isQuiet = isEveryFileQuiet && !(corner === '"sideEffects": the file that hands on' && isFirst);
    files[root + path] =
      forms[form](sources) +
      (isFirst && isLabeled
        ? isModule
          ? `export const which = "${label}";\n`
          : `module.exports.which = "${label}";\n`
        : "") +
      (isFirst && lazy !== "none"
        ? isModule
          ? `export function lazy() {\n  return import.meta.require(${toLast ?? beside(lastPath)});\n}\n`
          : `module.exports.lazy = function lazy() {\n  return require(${toLast ?? beside(lastPath)});\n};\n`
        : "") +
      (isLoud && !isQuiet ? ran(`${name} ${label}`.trim()) : "");
    if (isFirst && isTyped) files[root + declarationOf(path)] = declaration;
    if (isFirst) entries.push(path);
    if (isFirst && isModule) isEveryEntryCommonJS = false;
    return `./${path}`;
  };
  const middle = hasMiddle ? hands("middle", undefined, "", false, toLast ?? beside(lastPath)) : undefined;
  const index = (label = "", wantsAModule?: boolean, name = "index") =>
    hands(name, wantsAModule, label, true, middle ? beside(middle.slice(2)) : (toLast ?? beside(lastPath)));
  /** A file that nothing is to reach. */
  const decoy = (name: string) => {
    const path = `${folder}${name}.${endingOf(false)}`;
    files[root + path] =
      `exports.c = "the wrong file";\nexports.change = function () {};\nexports.e = -1;\nexports.which = "${name}";\nexports.lazy = function () {\n  return exports;\n};\n` +
      (hasDefault ? `exports.default = "the wrong file";\n` : "");
    return `./${path}`;
  };

  let about: Record<string, unknown> = inProject ? { name: "project" } : { name: packageName, version: "1.0.0" };
  if (type) about.type = type;
  let from = packageName;
  const typed = (path: string) => (isTyped ? { types: declarationOf(path), default: path } : path);
  switch (corner) {
    case "only a name":
      index();
      break;
    case '"main" without its ending':
      about.main = index().replace(/\.js$/, "");
      break;
    case '"main": a folder':
      index();
      about.main = random.pick(["./lib", "lib", "./lib/"]);
      break;
    case '"module" beside "main"':
      about.main = index("main", false);
      about.module = index("module", true, "index-module");
      break;
    case '"module" alone':
      about.module = index("", true);
      if (isTyped) about.types = declarationOf(about.module as string);
      break;
    case '"browser" beside "main"':
      about.main = index("main");
      about.browser = decoy("browser");
      break;
    case '"browser" replaces the last file':
      about.main = index();
      about.browser = { [`./${lastPath}`]: decoy("inner-browser") };
      break;
    case '"browser" removes the last file':
      about.main = index();
      about.browser = { [`./${lastPath}`]: false };
      break;
    case '"exports": a text':
      about.exports = index();
      break;
    case '"exports": "."':
      about.exports = { ".": typed(index()) };
      break;
    case '"exports": "import" and "require"': {
      const both = [
        ["import", typed(index("import", true, "index-import"))],
        ["require", typed(index("require", false, "index-require"))],
      ];
      about.exports = { ".": Object.fromEntries(random.chance(0.5) ? both : both.reverse()) };
      break;
    }
    case '"exports": "bun", "node" and "default"':
      about.exports = {
        ".": Object.fromEntries([
          ...random.shuffled([
            ["bun", typed(index("bun", undefined, "index-bun"))],
            ["node", typed(index("node", undefined, "index-node"))],
          ]),
          ["default", typed(index("default", undefined, "index-default"))],
        ]),
      };
      break;
    case '"exports": nested':
      about.exports = {
        ".": {
          [random.pick(["node", "bun", "import"])]: {
            import: typed(index("import", true, "index-import")),
            default: typed(index("inner default", false, "index-require")),
          },
          default: typed(index("default", undefined, "index-default")),
        },
      };
      break;
    case '"exports": a path below':
      about.exports = { ".": typed(decoy("root")), "./entry": typed(index()) };
      if (isTyped) files[root + declarationOf(`${folder}root.${endingOf(false)}`)] = declaration;
      from += "/entry";
      break;
    case '"exports": a pattern': {
      const path = index();
      about.exports = { [`./*`]: `./lib/*.${path.split(".").pop()}` };
      from += "/index";
      break;
    }
    case '"exports" beside "main"':
      about.main = decoy("main");
      about.exports = { ".": typed(index("exports")) };
      break;
    case '"imports"':
      about.main = index();
      about.imports = { "#inner": `./${lastPath}` };
      break;
    case "a package.json further down":
      about.main = index();
      files[`${root}lib/package.json`] =
        JSON.stringify({ ...(type && { type }), ...(random.chance(0.7) && { sideEffects: false }) }, null, 2) + "\n";
      break;
    case "the package.json of the project":
      from = index();
      break;
    case "a folder of the project":
      about = { name: "p" };
      if (type) about.type = type;
      about.main = index();
      from = random.chance(0.7) ? `./p/${(about.main as string).slice(2)}` : "./p";
      break;
    default:
      about.main = index();
      if (random.chance(0.3)) about.main = (about.main as string).slice(2);
  }
  if (corner === '"sideEffects": the file that hands on') about.sideEffects = [`./${entries[0]}`];
  else if (corner === '"sideEffects": the last file') about.sideEffects = [`./${lastPath}`];
  else if (effects !== undefined) about.sideEffects = effects;
  files[`${root}package.json`] = JSON.stringify(about, null, 2) + "\n";

  if (isTyped)
    files["tsconfig.json"] =
      JSON.stringify(
        {
          compilerOptions: {
            target: "esnext",
            module: "preserve",
            moduleResolution: "bundler",
            noEmit: true,
            strict: true,
            types: [],
          },
        },
        null,
        2,
      ) + "\n";

  // The ES modules between the package and the program.
  const barrelEnding = ending === "cjs" ? "mjs" : ending;
  const taken = [...names, ...(isLabeled ? ["which"] : []), ...(lazy !== "none" ? ["lazy"] : [])];
  const isInside =
    isBarrelInside && !about.exports && !inProject && side !== "none" && !isTyped && entries.length === 1;
  const place = isInside ? root : "";
  const insideEnding = type === "module" ? "js" : "mjs";
  const barrelName = (name: string) => `${place}${name}.${isInside ? insideEnding : barrelEnding}`;
  const to = (name: string) =>
    JSON.stringify(isInside ? `./${name}.${insideEnding}` : isTyped ? `./${name}` : `./${name}.${barrelEnding}`);
  const source = (below: string): Source[] => [{ variable: "inner", names: taken, below }];
  const first = JSON.stringify(isInside ? `./${entries[0]}` : from);
  if (side === "a star of names" || side === "names of a star") {
    files[barrelName("barrel")] = moduleForms[side === "a star of names" ? "export * from" : "export { } from"](
      source(to("second-barrel")),
    );
    files[barrelName("second-barrel")] = moduleForms[side === "a star of names" ? "export { } from" : "export * from"](
      source(first),
    );
  } else if (side !== "none") files[barrelName("barrel")] = moduleForms[side](source(first));
  const reached =
    side === "none"
      ? JSON.stringify(from)
      : isInside
        ? JSON.stringify(`${packageName}/barrel.${insideEnding}`)
        : to("barrel");

  // The last file, and the file whose name nobody takes.
  const backTo =
    isBackToTheBarrel && side === "export * from" && second === "none" && !isInside && barrelEnding === "mjs"
      ? JSON.stringify(`${"../".repeat((root + folder).split("/").length - 1)}barrel.mjs`)
      : beside(entries[0]);
  const back =
    cycle === "none" || isLastAModule || entries.length !== 1 || !isEveryEntryCommonJS
      ? ""
      : `try {\n  (globalThis.seen ??= []).push(${cycle === "the keys" ? `Object.keys(require(${backTo})).join()` : `typeof require(${backTo}).c`});\n} catch (error) {\n  (globalThis.seen ??= []).push("THROWS " + error.constructor.name);\n}\n`;
  const told = isLoud ? ran("inner") : "";
  const members = (holder: string) =>
    `{\n  c: ${value.first},\n  change() {\n    ${holder}.c = ${value.next};\n  },\n${hasDefault ? `  default: "whole",\n` : ""}}`;
  files[root + lastPath] =
    hidden === "computed keys"
      ? `${isLastMarked ? mark : ""}${told}const made = ${members("exports")};\nfor (const key of Object.keys(made)) exports[key] = made[key];\n${back}`
      : hidden === "made by a function"
        ? `${told}function make() {\n  return ${members("module.exports")};\n}\nmodule.exports = make();\n${back}`
        : hidden === "Object.assign"
          ? `${isLastMarked ? mark : ""}${told}Object.assign(exports, ${members("exports")});\n${back}`
          : hidden === "defined in a loop"
            ? `${isLastMarked ? mark : ""}${told}const held = ${members("held")};\nfor (const key of Object.keys(held))\n  Object.defineProperty(exports, key, {\n    enumerable: true,\n    get() {\n      return held[key];\n    },\n  });\n${back}`
            : isLastAModule
              ? `${told}export ${last} c = ${value.first};\nexport function change() {${isConstant ? "" : `\n  c = ${value.next};\n`}}\n${hasDefault ? `export default "whole";\n` : ""}`
              : last === "a literal"
                ? `${told}module.exports = {\n  c: ${value.first},\n  change() {\n    module.exports.c = ${value.next};\n  },\n${hasDefault ? `  default: "whole",\n` : ""}};\n${back}`
                : last === "as TypeScript emits it"
                  ? `"use strict";\n${mark}exports.c = void 0;\nexports.change = change;\n${told}exports.c = ${value.first};\nfunction change() {\n  exports.c = ${value.next};\n}\n${hasDefault ? `exports.default = "whole";\n` : ""}${back}`
                  : `${isLastMarked ? mark : ""}${told}exports.c = ${value.first};\nexports.change = function () {\n  exports.c = ${value.next};\n};\n${hasDefault ? `exports.default = "whole";\n` : ""}${back}`;
  if (hasOther)
    files[`${root}${folder}other.${endingOf(false)}`] =
      `${isLoud && !isEveryFileQuiet ? ran("other") : ""}exports.e = 5;\n${isOtherAlike ? `exports.c = "of the other file";\n` : ""}`;

  const reach =
    ending === "cjs"
      ? "require"
      : random.weighted([
          [5, "by name"],
          [3, "the namespace"],
          [side === "none" && !hasDefault && !isTyped && isEveryEntryCommonJS ? 2 : 0, "the default"],
          [isTyped && side === "none" && !hasDefault ? 2 : 0, "import = require"],
          [2, "import()"],
        ] as const);
  const head: string[] = [];
  let holder = "";
  if (reach === "by name")
    head.push(`import { ${taken.filter(name => name !== "default").join(", ")} } from ${reached};`);
  if (reach === "the namespace") head.push(`import * as ${(holder = "everything")} from ${reached};`);
  if (reach === "the default") head.push(`import ${(holder = "entire")} from ${reached};`);
  if (reach === "import = require") head.push(`import ${(holder = "required")} = require(${reached});`);
  if (reach === "require") head.push(`const ${(holder = "required")} = require(${reached});`);
  if (reach === "import()") head.push(`const ${(holder = "later")} = await import(${reached});`);
  if (hasDefault && reach === "by name") head.push(`import whole from ${reached};`);
  const read = (name: string) => (holder ? `${holder}.${name}` : name);
  const whole = hasDefault ? (holder ? `${holder}.default` : "whole") : undefined;

  // The second importer has a name of its own, which the program takes: an import that nobody refers to is not drawn.
  const takesSecond = (file: string) =>
    head.push(
      ending === "cjs"
        ? `const { second } = require("./${file}");`
        : `${isTyped && file.endsWith(".cjs") ? "// @ts-ignore\n" : ""}import { second } from "./${isTyped && !file.endsWith(".cjs") ? "second" : file}";`,
    );
  let hasSecond = true;
  if (second === "the other name" && hasOther) {
    files[`second.${barrelEnding}`] = `import { e } from ${JSON.stringify(from)};\nexport const second = e;\n`;
    takesSecond(`second.${barrelEnding}`);
  } else if (second === "the same name") {
    files[`second.${barrelEnding}`] = `import { c } from ${JSON.stringify(from)};\nexport const second = typeof c;\n`;
    takesSecond(`second.${barrelEnding}`);
  } else if (second === "the package is required") {
    files["second.cjs"] =
      `const required = require(${JSON.stringify(from)});\nexports.second = typeof required.c + " " + required.which;\n`;
    takesSecond("second.cjs");
  } else hasSecond = false;

  const anything = isTyped ? "(globalThis as any)" : "globalThis";
  const lines: string[] = [];
  const say = (label: string, expression: string) =>
    lines.push(
      "try {",
      ...(loops
        ? [
            "  let result;",
            `  for (let turn = 0; turn < 10000; turn++) result = ${expression};`,
            `  console.log("${label}", result);`,
          ]
        : [`  console.log("${label}", ${expression});`]),
      "} catch (error) {",
      `  console.log("${label}", "THROWS", error instanceof TypeError ? "TypeError" : error instanceof ReferenceError ? "ReferenceError" : typeof error);`,
      "}",
    );
  const use = () => random.pick(uses[kind]).replaceAll("§", read("c"));
  say("at first", use());
  if (isLabeled) say("which", read("which"));
  if (whole) say("the default", `typeof ${whole} + " " + String(${whole})`);
  // An executable that is built without --aot reads a name of a CommonJS file anew each time, `bun run` and --aot hold what it was when the file was loaded: there nothing changes.
  if (!isJudgedAsAnExecutable) {
    say("change", `${read("change")}()`);
    say("changed", use());
  }
  if (lazy === "called") say("lazy", random.pick(uses[kind]).replaceAll("§", `(${read("lazy")}().c)`));
  if (holder && reach !== "import = require") lines.push(`console.log("keys", Object.keys(${holder}).sort().join());`);
  lines.push(
    `console.log("ran", (${anything}.ran ?? []).sort().join(), "seen", ${anything}.seen${hasSecond ? `, "second", second` : ""});`,
  );
  if (Object.values(files).some(text => text.includes(`require("tslib")`))) Object.assign(files, tslib);
  const isModule = head.some(line => /^(?:\/\/ @ts-ignore\n)?import /.test(line));
  return {
    file: `main.${ending}`,
    text: [...head, ...lines, ...(isModule || ending === "cjs" ? [] : ["export {};"])].join("\n") + "\n",
    files,
  };
}
