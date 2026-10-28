// Small programs in which a CommonJS file requires an ES module (`corners`: what the module exports), straight or through the helpers that compilers put around `require`, and prints what it got: its kind, its
// keys, its members, what a store, a new member and a removal do to it, and what it shows behind a change in the module.
//
//   the module    names; a default; both; an export named `__esModule`, true or false; an export named "module.exports", alone or beside others; `export *` over an ES module or a CommonJS file; the default of a
//                 CommonJS file handed on; nothing; declarations; a default that has a member `default`; a name in quotes; a default that is assigned again
//   taken by      `require`, a pattern, `__importDefault`, `__importStar`, `_interopRequireDefault`, `_interopRequireWildcard`, `__toESM` in both forms, `createRequire`, `import.meta.require`
//   beside it     nobody else, or an ES module that imports the same module, ahead of the `require` or behind it
//
// Every read stands in a try. The executable prints what plain Bun prints and ends as it ends.
import type { Random } from "./random";

const modules = {
  names: `export const a = 1;\nexport let b = 2;\nexport function change() {\n  b = 12;\n}\n`,
  "a default": `export default "whole";\n`,
  "a default and names": `export default "whole";\nexport const a = 1;\nexport let b = 2;\nexport function change() {\n  b = 12;\n}\n`,
  "the flag": `export const __esModule = true;\nexport default "whole";\nexport const a = 1;\n`,
  "the flag alone": `export const __esModule = true;\nexport const a = 1;\n`,
  "the flag is false": `export const __esModule = false;\nexport default "whole";\nexport const a = 1;\n`,
  '"module.exports"': `const whole = { a: 1 };\nexport { whole as "module.exports" };\n`,
  '"module.exports" beside others': `const whole = { a: 1 };\nexport { whole as "module.exports" };\nexport const a = 5;\nexport default "whole";\n`,
  '"module.exports" is a function': `function whole() {\n  return 1;\n}\nexport { whole as "module.exports" };\nexport const a = 5;\n`,
  "a star over an ES module": `export * from "./deeper.mjs";\n`,
  "a star over a CommonJS file": `export * from "./deeper.cjs";\n`,
  "the default of a CommonJS file": `export { default } from "./deeper.cjs";\n`,
  "names of a CommonJS file": `export { a, b } from "./deeper.cjs";\n`,
  nothing: `export {};\n`,
  declarations: `export function a() {\n  return 1;\n}\nexport class b {\n  c = 2;\n}\nexport default function whole() {\n  return 3;\n}\n`,
  "a default with a member default": `export default { default: "deeper", a: 1 };\n`,
  "a name in quotes": `const x = 1;\nexport { x as "a-b", x as a };\n`,
  "a default that is assigned again": `export default function whole() {\n  return 1;\n}\nexport function change() {\n  whole = function () {\n    return 2;\n  };\n}\n`,
} as const;
export const corners = Object.keys(modules) as (keyof typeof modules)[];

const importStar = `var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {\n    if (k2 === undefined) k2 = k;\n    var desc = Object.getOwnPropertyDescriptor(m, k);\n    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {\n      desc = { enumerable: true, get: function() { return m[k]; } };\n    }\n    Object.defineProperty(o, k2, desc);\n}) : (function(o, m, k, k2) {\n    if (k2 === undefined) k2 = k;\n    o[k2] = m[k];\n}));\nvar __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {\n    Object.defineProperty(o, "default", { enumerable: true, value: v });\n}) : function(o, v) {\n    o["default"] = v;\n});\nvar __importStar = (this && this.__importStar) || function (mod) {\n    if (mod && mod.__esModule) return mod;\n    var result = {};\n    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);\n    __setModuleDefault(result, mod);\n    return result;\n};\n`;
const wildcard = `function _interopRequireWildcard(e, t) { if ("function" == typeof WeakMap) var r = new WeakMap(), n = new WeakMap(); return (_interopRequireWildcard = function (e, t) { if (!t && e && e.__esModule) return e; var o, i, f = { __proto__: null, default: e }; if (null === e || "object" != typeof e && "function" != typeof e) return f; if (o = t ? n : r) { if (o.has(e)) return o.get(e); o.set(e, f); } for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]); return f; })(e, t); }\n`;
const toESM = `var __create = Object.create;\nvar __defProp = Object.defineProperty;\nvar __getOwnPropDesc = Object.getOwnPropertyDescriptor;\nvar __getOwnPropNames = Object.getOwnPropertyNames;\nvar __getProtoOf = Object.getPrototypeOf;\nvar __hasOwnProp = Object.prototype.hasOwnProperty;\nvar __copyProps = (to, from, except, desc) => {\n  if (from && typeof from === "object" || typeof from === "function") {\n    for (let key of __getOwnPropNames(from))\n      if (!__hasOwnProp.call(to, key) && key !== except)\n        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });\n  }\n  return to;\n};\nvar __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(\n  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,\n  mod\n));\n`;

/** How the CommonJS file takes the module: the text that declares `got`. */
const takes = {
  require: `const got = require("./inner.mjs");\n`,
  "a variable by var": `var got = require("./inner.mjs");\n`,
  __importDefault: `var __importDefault = (this && this.__importDefault) || function (mod) {\n    return (mod && mod.__esModule) ? mod : { "default": mod };\n};\nconst got = __importDefault(require("./inner.mjs"));\n`,
  __importStar: `${importStar}const got = __importStar(require("./inner.mjs"));\n`,
  _interopRequireDefault: `var got = _interopRequireDefault(require("./inner.mjs"));\nfunction _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }\n`,
  _interopRequireWildcard: `var got = _interopRequireWildcard(require("./inner.mjs"));\n${wildcard}`,
  __toESM: `${toESM}var got = __toESM(require("./inner.mjs"));\n`,
  "__toESM for Node": `${toESM}var got = __toESM(require("./inner.mjs"), 1);\n`,
  "a spread": `const got = { ...require("./inner.mjs") };\n`,
} as const;

export function generate(
  random: Random,
  corner: (typeof corners)[number],
): { file: string; text: string; files: Record<string, string> } {
  // The relations first.
  const taken = random.pick(Object.keys(takes) as (keyof typeof takes)[]);
  const isStrict = random.chance(0.5);
  const main = random.weighted([
    [4, "the file itself"],
    [3, "an ES module imports the file"],
    [1, "createRequire"],
    [1, "import.meta.require"],
  ] as const);
  const beside = random.weighted([
    [5, "nobody"],
    [2, "imported ahead"],
    [2, "imported behind"],
  ] as const);
  const asked = random.sample(
    ["the tag", "the descriptor", "a store", "a new member", "a removal", "the same again"] as const,
    random.between(1, 3),
  );

  const files: Record<string, string> = { "inner.mjs": modules[corner] };
  if (modules[corner].includes("./deeper.mjs")) files["deeper.mjs"] = `export const a = 1;\nexport default "deeper";\n`;
  if (modules[corner].includes("./deeper.cjs"))
    files["deeper.cjs"] = `exports.a = 1;\nexports.b = 2;\nexports.default = "deeper";\n`;

  const say = (label: string, expression: string) =>
    `try {\n  console.log("${label}:", ${expression});\n} catch (error) {\n  console.log("${label}:", "THROWS", error.constructor.name);\n}\n`;
  const kind = (expression: string) =>
    `typeof ${expression} === "function" ? "function " + ${expression}.name : typeof ${expression} === "object" ? JSON.stringify(${expression}) : ${expression}`;
  const questions = {
    "the tag": say("tag", `Object.prototype.toString.call(got)`),
    "the descriptor": say(
      "descriptor of a",
      `JSON.stringify(Object.getOwnPropertyDescriptor(got, "a"), (key, value) => (typeof value === "function" ? "function" : value))`,
    ),
    "a store": say("a store", `((got.a = 7), got.a)`),
    "a new member": say("a new member", `((got.added = 7), Object.keys(got).sort().join())`),
    "a removal": say("a removal", `[delete got.a, "a" in got].join()`),
    "the same again": say("the same again", `require("./inner.mjs") === require("./inner.mjs")`),
  };
  const body =
    say("it is", `typeof got`) +
    say("keys", `Object.keys(got).sort().join()`) +
    say("own names", `Object.getOwnPropertyNames(got).sort().join()`) +
    say("a", kind("got.a")) +
    say("default", kind("got.default")) +
    say("the flag", `got.__esModule`) +
    (modules[corner].includes("function change")
      ? say("change", `got.change()`) +
        say("b", `got.b`) +
        say("default behind it", `typeof got.default === "function" ? got.default() : got.default`)
      : "") +
    asked.map(what => questions[what]).join("");
  const importsIt = `import * as seen from "./inner.mjs";\nexport const second = Object.keys(seen).sort().join();\n`;
  const strict = isStrict ? `"use strict";\n` : "";
  if (beside !== "nobody") files["second.mjs"] = importsIt;

  if (main === "the file itself") {
    const second = `console.log("second:", require("./second.mjs").second);\n`;
    return {
      file: "main.cjs",
      text:
        strict +
        (beside === "imported ahead" ? second : "") +
        takes[taken] +
        body +
        (beside === "imported behind" ? second : ""),
      files,
    };
  }
  const second = `import { second } from "./second.mjs";\n`;
  const tells = beside === "nobody" ? "" : `console.log("second:", second);\n`;
  if (main === "an ES module imports the file") {
    files["lib.cjs"] = strict + takes[taken] + body;
    return {
      file: "main.mjs",
      text:
        (beside === "imported ahead" ? second : "") +
        `import "./lib.cjs";\n` +
        (beside === "imported behind" ? second : "") +
        tells,
      files,
    };
  }
  const require =
    main === "createRequire"
      ? `import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\n`
      : `const require = import.meta.require;\n`;
  return {
    file: "main.mjs",
    text:
      (beside === "nobody" ? "" : second) +
      require +
      `const got = require("./inner.mjs");\n` +
      body +
      tells +
      "export {};\n",
    files,
  };
}
