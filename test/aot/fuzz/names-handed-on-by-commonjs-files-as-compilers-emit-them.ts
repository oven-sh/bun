// Small programs in which a name reaches its importers through CommonJS files as compilers emit them and through ES modules that export them again. The CommonJS files may have declaration files, which say what
// the name is, something else, or something invalid. TypeScript accepts every program, and the executable prints what plain Bun prints. Each graph has files of its own. In this order are drawn:
//
//   handed on      `corners`: how TypeScript, Babel, swc and esbuild emit `export { x } from`, `export * from` and `export * as`, with their helpers, and seven ways to write it by hand; one to three such files in
//                  a row, all alike or each in its own way; under the same name or another; with and without `__esModule` and `exports.x = void 0`; where `isWider`, mostly the default, mostly
//                  without the helpers of `esModuleInterop`, and half of the files at the end are written by hand
//   at the end     a number, a text, an object, a list, a function, a class, an enum, a variable that changes, under a name or as the default, as one of the five writes it; an ES module; JSON; or the name is not
//                  there at all (`lacks`): what a compiler that reads one file at a time emits for a type that is exported again
//   where it lies  files of the project, a package in node_modules with one of five package.json, two packages of which one requires the other; where `isQuiet`, always packages, which say "sideEffects": false
//   declarations   none; a file for each file, as TypeScript emits them; one file for all; another type, another literal, other fields, other values of the enum, `const` for what changes; something invalid beside
//                  or in the declaration under `skipLibCheck`; what TypeScript infers from the JavaScript
//   the ES side    none, or one to three modules in `.ts` or `.mjs`: `export *`, `export { x } from`, under another name, `export * as`, imported and exported, read off the namespace or the default, to and from
//                  the default, a star beside a name of its own, beside another star, beside a name that hides it
//   who imports    `.ts`, `.mjs` or `.cjs`; by name, under another name, the namespace, the default, both, `require`, `import()`; a second importer on the same road or another, ahead of it or behind it, or none
//   a cycle        none; the last CommonJS file requires the first; an ES module imports the importer; the last CommonJS file requires the ES module
//   what is done   what the said type allows: it is printed, called, constructed, extended, added to, listed; once or in a loop of ten thousand turns; ahead of and behind a change
import type { Random } from "./random";

export const corners = [
  "TypeScript, names",
  "TypeScript, a star",
  "TypeScript, a namespace",
  "TypeScript, stores",
  "Babel, names",
  "Babel, a star",
  "Babel, a namespace",
  "swc, names",
  "swc, names by functions",
  "swc, a star",
  "swc, a namespace",
  "esbuild, names",
  "esbuild, a star",
  "esbuild, a namespace",
  "by hand, the whole",
  "by hand, Object.assign",
  "by hand, a spread",
  "by hand, stores",
  "by hand, a literal of what was taken apart",
  "by hand, getters in a literal",
  "by hand, getters that are not listed",
] as const;
type Corner = (typeof corners)[number];
type Tool = "TypeScript" | "Babel" | "swc" | "esbuild" | "by hand";

// What the compilers put at the head of a file.
const mark = `Object.defineProperty(exports, "__esModule", { value: true });\n`;
const markOverLines = (indent: string) => `Object.defineProperty(exports, "__esModule", {\n${indent}value: true\n});\n`;
const createBinding = `var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
`;
const exportStar = `var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
`;
const importStar = `var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
`;
const importDefault = `var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
`;
const babelDefault = `function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }\n`;
const babelWildcard = `function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && {}.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
`;
const swcExport = (get: string) => `function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: ${get}
    });
}
`;
const swcExportStar = `function _export_star(from, to) {
    Object.keys(from).forEach(function(k) {
        if (k !== "default" && !Object.prototype.hasOwnProperty.call(to, k)) {
            Object.defineProperty(to, k, {
                enumerable: true,
                get: function() {
                    return from[k];
                }
            });
        }
    });
    return from;
}
`;
const swcDefault = `function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
`;
const swcWildcard = `function _getRequireWildcardCache(nodeInterop) {
    if (typeof WeakMap !== "function") return null;
    var cacheBabelInterop = new WeakMap();
    var cacheNodeInterop = new WeakMap();
    return (_getRequireWildcardCache = function(nodeInterop) {
        return nodeInterop ? cacheNodeInterop : cacheBabelInterop;
    })(nodeInterop);
}
function _interop_require_wildcard(obj, nodeInterop) {
    if (!nodeInterop && obj && obj.__esModule) {
        return obj;
    }
    if (obj === null || typeof obj !== "object" && typeof obj !== "function") {
        return {
            default: obj
        };
    }
    var cache = _getRequireWildcardCache(nodeInterop);
    if (cache && cache.has(obj)) {
        return cache.get(obj);
    }
    var newObj = {
        __proto__: null
    };
    var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for(var key in obj){
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
            var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
            if (desc && (desc.get || desc.set)) {
                Object.defineProperty(newObj, key, desc);
            } else {
                newObj[key] = obj[key];
            }
        }
    }
    newObj.default = obj;
    if (cache) {
        cache.set(obj, newObj);
    }
    return newObj;
}
`;
const esbuildHead = (needs: { export?: boolean; reExport?: boolean; toESM?: boolean }) =>
  (needs.toESM ? "var __create = Object.create;\n" : "") +
  `var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
` +
  (needs.toESM ? "var __getProtoOf = Object.getPrototypeOf;\n" : "") +
  "var __hasOwnProp = Object.prototype.hasOwnProperty;\n" +
  (needs.export
    ? `var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
`
    : "") +
  `var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
` +
  (needs.reExport
    ? `var __reExport = (target, mod, secondTarget) => (__copyProps(target, mod, "default"), secondTarget && __copyProps(secondTarget, mod, "default"));\n`
    : "") +
  (needs.toESM
    ? `var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
`
    : "") +
  `var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);\n`;
const esbuildNames = (names: string[]) =>
  names.length
    ? `// Annotate the CommonJS export names for ESM import in node:\n0 && (module.exports = {\n${names.map(name => `  ${name}`).join(",\n")}\n});\n`
    : "";

/** What the types allow. `$` is the name, `§` the literal that its type is, or what it holds. */
const usesOf = {
  number: [
    "$",
    "$ + 1",
    "$ * 2",
    "typeof $",
    "$ === §",
    "$ === § ? 1 : 2",
    "$.toFixed(1)",
    "$ | 0",
    "-$",
    "[$, $].length",
    "$ > 2 ? 1 : 2",
  ],
  text: [
    "$",
    "typeof $",
    "$.length",
    `$ + "!"`,
    "$.toUpperCase()",
    "$.charCodeAt(0)",
    "$ === §",
    "$ === § ? 1 : 2",
    "$.slice(1)",
  ],
  function: ["typeof $", "$()", "$() + 1", "$.length", "$.name", "[$].map(each => each())[0]", "$.call(undefined)"],
  "function of a text": ["typeof $", "$().length", `$() + "!"`, "$().toUpperCase()"],
  class: [
    "typeof $",
    "new $().a",
    "new $().a + 1",
    "new $().area()",
    "new $() instanceof $",
    "new (class extends $ {})().area()",
    "$.name",
    "Object.keys(new $()).join()",
  ],
  "class of other fields": ["new $().a.length", "new $().b", "new $().b + 1", "new $().area().length"],
  object: ["typeof $", "$.a", "$.a + 1", "JSON.stringify($)", "Object.keys($).join()", `"a" in $`, "{ ...$ }.a"],
  "object of other fields": ["$.a.length", "$.b", "$.b + 1", "$.b.toFixed(1)"],
  list: [
    "typeof $",
    "$.length",
    "$[0]",
    "$[0] + 1",
    `$.join("+")`,
    "$.slice(1)[0]",
    "$.at(-1)",
    "$.concat($).length",
    "Array.isArray($)",
    "[...$].length",
  ],
  "list of texts": ["$[0].length", "$[0].toUpperCase()", `$.join("-")`, "$[1].length", "$.slice(1)[0].length"],
  enum: [
    "typeof $",
    "$.Red",
    "$.Green + 1",
    "$[0]",
    "$[$.Green]",
    "Object.keys($).length",
    "$.Red + $.Green",
    "[$.Green].length",
  ],
} as const;
type Said = { declare: (name: string) => string; type: string; uses: keyof typeof usesOf };

const shape = (a: string, more = "", area = "number") => `{\n    a: ${a};${more}\n    area(): ${area};\n}`;
const saidOf = {
  sides: { declare: name => `export declare const ${name} = 4;`, type: "4", uses: "number" },
  label: { declare: name => `export declare const ${name} = "text";`, type: `"text"`, uses: "text" },
  options: {
    declare: name => `export declare const ${name}: {\n    a: number;\n};`,
    type: "{ a: number }",
    uses: "object",
  },
  list: { declare: name => `export declare const ${name}: number[];`, type: "number[]", uses: "list" },
  make: { declare: name => `export declare function ${name}(): number;`, type: "() => number", uses: "function" },
  Shape: {
    declare: name => `export declare class ${name} ${shape("number")}`,
    type: `new () => ${shape("number")}`,
    uses: "class",
  },
  Color: {
    declare: name => `export declare enum ${name} {\n    Red = 0,\n    Green = 1\n}`,
    type: "{ readonly Red: 0; readonly Green: 1; readonly [index: number]: string }",
    uses: "enum",
  },
  count: { declare: name => `export declare let ${name}: number;`, type: "number", uses: "number" },
} satisfies Record<string, Said>;
type Kind = keyof typeof saidOf;
const kinds = Object.keys(saidOf) as Kind[];

/** What declarations say that are near the truth and not the truth. Declarations may also say what is true of another kind. */
const nearly: Record<Kind, Said[]> = {
  sides: [
    { declare: name => `export declare const ${name} = 5;`, type: "5", uses: "number" },
    { declare: name => `export declare const ${name}: 0;`, type: "0", uses: "number" },
  ],
  label: [{ declare: name => `export declare const ${name} = "other";`, type: `"other"`, uses: "text" }],
  options: [
    {
      declare: name => `export declare const ${name}: {\n    a: string;\n    b: number;\n};`,
      type: "{ a: string; b: number }",
      uses: "object of other fields",
    },
    {
      declare: name => `export declare const ${name}: {\n    readonly a: 2;\n};`,
      type: "{ readonly a: 2 }",
      uses: "object",
    },
  ],
  list: [
    { declare: name => `export declare const ${name}: string[];`, type: "string[]", uses: "list of texts" },
    { declare: name => `export declare const ${name}: readonly [3, 4, 5];`, type: "readonly [3, 4, 5]", uses: "list" },
  ],
  make: [
    { declare: name => `export declare function ${name}(): string;`, type: "() => string", uses: "function of a text" },
  ],
  Shape: [
    {
      declare: name => `export declare class ${name} ${shape("string", "\n    b: number;", "string")}`,
      type: `new () => ${shape("string", "\n    b: number;", "string")}`,
      uses: "class of other fields",
    },
  ],
  Color: [
    {
      declare: name => `export declare enum ${name} {\n    Red = 1,\n    Green = 2\n}`,
      type: "{ readonly Red: 1; readonly Green: 2; readonly [index: number]: string }",
      uses: "enum",
    },
    {
      declare: name => `export declare const enum ${name} {\n    Red = 5,\n    Green = 6\n}`,
      type: "{ readonly Red: 5; readonly Green: 6 }",
      uses: "enum",
    },
  ],
  count: [{ declare: name => `export declare const ${name} = 1;`, type: "1", uses: "number" }],
};
const declareAs = (said: Said, exported: string) =>
  exported === "default" ? `declare const _default: ${said.type};\nexport default _default;` : said.declare(exported);

const values: Partial<Record<Kind, string>> = {
  sides: "4",
  label: `"text"`,
  options: "{ a: 1 }",
  list: "[1, 2]",
  count: "1",
};
const functionOf = (name: string, indent: string) => `function ${name}() {\n${indent}return 1;\n}`;
const classOf = (name: string, indent: string) =>
  `class ${name} {\n${indent}a = 1;\n${indent}area() {\n${indent}${indent}return this.a * 2;\n${indent}}\n}`;
const members = (name: string, indent: string) =>
  `${indent}${name}[${name}["Red"] = 0] = "Red";\n${indent}${name}[${name}["Green"] = 1] = "Green";\n`;

type Item = { exported: string; kind: Kind };

/** The file at the end, as `tool` emits `export const sides = 4`, `export default ..` and the like. */
function lastFile(tool: Tool, items: Item[], base: string, random: Random, isMarked: boolean): string {
  // A function and a class keep their names where they are the default; a value gets the name that the tool gives it.
  const local = ({ exported, kind }: Item) =>
    exported !== "default"
      ? exported
      : kind === "make" || kind === "Shape"
        ? kind
        : tool === "esbuild"
          ? `${base}_default`
          : "_default";
  const hoisted = items.filter(item => item.kind === "make");
  const stored = items.filter(item => item.kind !== "make");
  const voids = stored.length
    ? `${stored
        .map(item => `exports.${item.exported}`)
        .reverse()
        .join(" = ")} = void 0;\n`
    : "";
  const change = (statement: string, indent: string, gap = " ") =>
    `globalThis.change = function${gap}() {\n${indent}${statement}\n};\n`;
  switch (tool) {
    case "TypeScript":
      return (
        `"use strict";\n${mark}${voids}${hoisted.map(item => `exports.${item.exported} = ${local(item)};\n`).join("")}` +
        items
          .map(item => {
            const [name, to] = [local(item), `exports.${item.exported}`];
            if (item.kind === "make") return `${functionOf(name, "    ")}\n`;
            if (item.kind === "Shape") return `${classOf(name, "    ")}\n${to} = ${name};\n`;
            if (item.kind === "Color")
              return `var ${name};\n(function (${name}) {\n${members(name, "    ")}})(${name} || (${to} = ${name} = {}));\n`;
            if (item.kind === "count") return `${to} = 1;\n${change(`${to} += 10;`, "    ")}`;
            return `${to} = ${values[item.kind]};\n`;
          })
          .join("")
      );
    case "Babel":
      return (
        `"use strict";\n\n${markOverLines("  ")}${voids}${hoisted.map(item => `exports.${item.exported} = ${local(item)};\n`).join("")}` +
        items
          .map(item => {
            const [name, to] = [local(item), `exports.${item.exported}`];
            if (item.kind === "make") return `${functionOf(name, "  ")}\n`;
            if (item.kind === "Shape") return `${classOf(name, "  ")}\n${to} = ${name};\n`;
            if (item.kind === "Color")
              return `let ${name} = ${to} = /*#__PURE__*/function (${name}) {\n${members(name, "  ")}  return ${name};\n}({});\n`;
            if (item.kind === "count") return `let ${name} = ${to} = 1;\n${change(`${to} = ${name} += 10;`, "  ")}`;
            return `${item.exported === "default" ? "var" : "const"} ${name} = ${to} = ${values[item.kind]};\n`;
          })
          .join("")
      );
    case "swc":
    case "esbuild": {
      const isSwc = tool === "swc";
      const indent = isSwc ? "    " : "  ";
      const bindings = items
        .map(item => {
          const name = local(item);
          if (item.kind === "make") return `${functionOf(name, indent)}\n`;
          if (item.kind === "Shape") return `${classOf(name, indent)}\n`;
          if (item.kind === "Color")
            return isSwc
              ? `var ${name} = /*#__PURE__*/ function(${name}) {\n${members(name, indent)}${indent}return ${name};\n}({});\n`
              : `var ${name} = /* @__PURE__ */ ((${name}2) => {\n${members(`${name}2`, indent)}${indent}return ${name}2;\n})(${name} || {});\n`;
          if (item.kind === "count") return `let ${name} = 1;\n${change(`${name} += 10;`, indent, isSwc ? "" : " ")}`;
          return `${item.exported === "default" && !isSwc ? "var" : "const"} ${name} = ${values[item.kind]};\n`;
        })
        .join("");
      if (!isSwc)
        return (
          `"use strict";\n${esbuildHead({ export: true })}var ${base}_exports = {};\n__export(${base}_exports, {\n` +
          `${items.map(item => `  ${item.exported}: () => ${local(item)}`).join(",\n")}\n});\nmodule.exports = __toCommonJS(${base}_exports);\n${bindings}` +
          esbuildNames(items.filter(item => item.exported !== "default").map(item => item.exported))
        );
      const getters =
        items.length === 1
          ? `Object.defineProperty(exports, "${items[0].exported}", {\n    enumerable: true,\n    get: function() {\n        return ${local(items[0])};\n    }\n});\n`
          : `${swcExport("Object.getOwnPropertyDescriptor(all, name).get")}_export(exports, {\n${items
              .map(item => `    get ${item.exported} () {\n        return ${local(item)};\n    }`)
              .join(",\n")}\n});\n`;
      return `"use strict";\n${markOverLines("    ")}${getters}${bindings}`;
    }
    case "by hand": {
      const written = (item: Item) =>
        item.kind === "make"
          ? functionOf(item.kind, "  ")
          : item.kind === "Shape"
            ? classOf(item.kind, "  ")
            : item.kind === "Color"
              ? `{ Red: 0, Green: 1, 0: "Red", 1: "Green" }`
              : values[item.kind]!;
      const changes = (holder: string) =>
        items
          .filter(item => item.kind === "count")
          .map(item => change(`${holder}.${item.exported} += 10;`, "  "))
          .join("");
      const stores = (holder: string, ahead = "") =>
        items.map(item => `${ahead}${holder}.${item.exported} = ${written(item)};\n`).join("");
      return random.weighted([
        [3, () => `"use strict";\n${isMarked ? mark : ""}${stores("exports")}${changes("exports")}`],
        [
          2,
          () =>
            `module.exports = {\n${items.map(item => `  ${item.exported}: ${written(item).replaceAll("\n", "\n  ")},\n`).join("")}};\n${changes("module.exports")}`,
        ],
        [
          1,
          () =>
            `function entry() {\n  return "entry";\n}\nmodule.exports = entry;\n${stores("module.exports")}${changes("module.exports")}`,
        ],
        [1, () => `${stores("exports", `if (typeof process === "object") `)}${changes("exports")}`],
      ] as const)();
    }
  }
}

/** `exported` of this file is `inner` of the file below. */
type Handed = { exported: string; inner: string };

/** A file that hands names of the file below on. `variable` is the name of that file as an identifier. */
function handsOn(
  corner: Corner,
  below: string,
  variable: string,
  base: string,
  handed: Handed[],
  isMarked: boolean,
  saysVoid: boolean,
  hasInterop: boolean,
): string {
  // Without `esModuleInterop` or with `noInterop` the default is read off what `require` answers, as any other name is. esbuild has no such option.
  const takesDefault = (hasInterop || corner.startsWith("esbuild")) && handed.some(({ inner }) => inner === "default");
  const takesNames = handed.some(({ inner }) => inner !== "default");
  const defaults = handed.filter(({ inner }) => inner === "default");
  const voids = saysVoid
    ? `${handed
        .map(({ exported }) => `exports.${exported}`)
        .reverse()
        .join(" = ")} = void 0;\n`
    : "";
  const overLines = (exported: string, value: string, indent: string, gap: string) =>
    `Object.defineProperty(exports, "${exported}", {\n${indent}enumerable: true,\n${indent}get: function${gap}() {\n${indent}${indent}return ${value};\n${indent}}\n});\n`;
  const own = isMarked ? mark : "";
  switch (corner) {
    case "TypeScript, names":
      return (
        `"use strict";\n${takesDefault ? importDefault : ""}${mark}${voids}var ${variable}_1 = require(${below});\n` +
        handed
          .map(
            ({ exported, inner }) =>
              `Object.defineProperty(exports, "${exported}", { enumerable: true, get: function () { return ${inner === "default" && hasInterop ? `__importDefault(${variable}_1).default` : `${variable}_1.${inner}`}; } });\n`,
          )
          .join("")
      );
    case "TypeScript, a star":
      return (
        `"use strict";\n${createBinding}${exportStar}${takesDefault ? importDefault : ""}${mark}${defaults.length && saysVoid ? "exports.default = void 0;\n" : ""}__exportStar(require(${below}), exports);\n` +
        (defaults.length
          ? `var ${variable}_1 = require(${below});\nObject.defineProperty(exports, "default", { enumerable: true, get: function () { return ${takesDefault ? `__importDefault(${variable}_1)` : `${variable}_1`}.default; } });\n`
          : "")
      );
    case "TypeScript, a namespace":
      return `"use strict";\n${createBinding}${importStar}${mark}exports.inner = void 0;\nexports.inner = __importStar(require(${below}));\n`;
    case "TypeScript, stores":
      return (
        `"use strict";\n${takesDefault && takesNames ? createBinding + importStar : takesDefault ? importDefault : ""}${mark}${voids}` +
        `const ${variable}_1 = ${takesDefault && takesNames ? `__importStar(require(${below}))` : takesDefault ? `__importDefault(require(${below}))` : `require(${below})`};\n` +
        handed.map(({ exported, inner }) => `exports.${exported} = ${variable}_1.${inner};\n`).join("")
      );
    case "Babel, names":
    case "Babel, a star": {
      const isStar = corner === "Babel, a star";
      const named = isStar ? defaults : handed;
      const takes =
        takesDefault && (takesNames || isStar)
          ? "_interopRequireWildcard"
          : takesDefault
            ? "_interopRequireDefault"
            : "";
      return (
        `"use strict";\n\n${markOverLines("  ")}${isStar && named.length ? "var _exportNames = {};\n" : ""}` +
        named.map(({ exported, inner }) => overLines(exported, `_${variable}.${inner}`, "  ", " ")).join("") +
        `var _${variable} = ${takes ? `${takes}(require(${below}))` : `require(${below})`};\n` +
        (isStar
          ? `Object.keys(_${variable}).forEach(function (key) {\n  if (key === "default" || key === "__esModule") return;\n${named.length ? "  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;\n" : ""}  if (key in exports && exports[key] === _${variable}[key]) return;\n  Object.defineProperty(exports, key, {\n    enumerable: true,\n    get: function () {\n      return _${variable}[key];\n    }\n  });\n});\n`
          : "") +
        (takes === "_interopRequireWildcard" ? babelWildcard : takes ? babelDefault : "")
      );
    }
    case "Babel, a namespace":
      return `"use strict";\n\n${markOverLines("  ")}exports.inner = void 0;\nvar _inner = _interopRequireWildcard(require(${below}));\nexports.inner = _inner;\n${babelWildcard}`;
    case "swc, names":
    case "swc, names by functions": {
      const takes =
        takesDefault && takesNames ? "_interop_require_wildcard" : takesDefault ? "_interop_require_default" : "";
      const isByFunctions = corner === "swc, names by functions";
      return (
        `"use strict";\n${markOverLines("    ")}` +
        (handed.length === 1 && !isByFunctions
          ? overLines(handed[0].exported, `_${variable}.${handed[0].inner}`, "    ", "")
          : `${swcExport(isByFunctions ? "all[name]" : "Object.getOwnPropertyDescriptor(all, name).get")}_export(exports, {\n${handed
              .map(({ exported, inner }) =>
                isByFunctions
                  ? `    ${exported}: function() {\n        return _${variable}.${inner};\n    }`
                  : `    get ${exported} () {\n        return _${variable}.${inner};\n    }`,
              )
              .join(",\n")}\n});\n`) +
        `const _${variable} = ${takes ? `/*#__PURE__*/ ${takes}(require(${below}))` : `require(${below})`};\n` +
        (takes === "_interop_require_wildcard" ? swcWildcard : takes ? swcDefault : "")
      );
    }
    case "swc, a star":
      return (
        `"use strict";\n${markOverLines("    ")}` +
        (defaults.length ? overLines("default", `_${variable}.default`, "    ", "") : "") +
        (takesDefault
          ? `const _${variable} = /*#__PURE__*/ _interop_require_wildcard(_export_star(require(${below}), exports));\n`
          : defaults.length
            ? `const _${variable} = _export_star(require(${below}), exports);\n`
            : `_export_star(require(${below}), exports);\n`) +
        swcExportStar +
        (takesDefault ? swcWildcard : "")
      );
    case "swc, a namespace":
      return `"use strict";\n${markOverLines("    ")}${overLines("inner", "_inner", "    ", "")}const _inner = /*#__PURE__*/ _interop_require_wildcard(require(${below}));\n${swcWildcard}`;
    case "esbuild, names":
      return (
        `"use strict";\n${esbuildHead({ export: true, toESM: takesDefault })}var ${base}_exports = {};\n__export(${base}_exports, {\n` +
        `${handed.map(({ exported, inner }) => `  ${exported}: () => import_${variable}.${inner}`).join(",\n")}\n});\nmodule.exports = __toCommonJS(${base}_exports);\n` +
        `var import_${variable} = ${takesDefault ? `__toESM(require(${below}))` : `require(${below})`};\n` +
        esbuildNames(handed.filter(({ exported }) => exported !== "default").map(({ exported }) => exported))
      );
    case "esbuild, a star":
      return (
        `"use strict";\n${esbuildHead({ export: takesDefault, reExport: true, toESM: takesDefault })}var ${base}_exports = {};\n` +
        (takesDefault ? `__export(${base}_exports, {\n  default: () => import_${variable}.default\n});\n` : "") +
        `module.exports = __toCommonJS(${base}_exports);\n__reExport(${base}_exports, require(${below}), module.exports);\n` +
        (takesDefault ? `var import_${variable} = __toESM(require(${below}));\n` : "") +
        `// Annotate the CommonJS export names for ESM import in node:\n0 && (module.exports = {\n  ...require(${below})\n});\n`
      );
    case "esbuild, a namespace":
      return (
        `"use strict";\n${esbuildHead({ export: true, toESM: true })}var ${base}_exports = {};\n__export(${base}_exports, {\n  inner: () => inner\n});\n` +
        `module.exports = __toCommonJS(${base}_exports);\nvar inner = __toESM(require(${below}));\n${esbuildNames(["inner"])}`
      );
    case "by hand, the whole":
      return `module.exports = require(${below});\n`;
    case "by hand, Object.assign":
      return `"use strict";\n${own}Object.assign(${isMarked ? "exports" : "module.exports"}, require(${below}));\n`;
    case "by hand, a spread":
      return `module.exports = { ...require(${below}) };\n`;
    case "by hand, stores":
      return `"use strict";\n${own}${voids}var ${variable} = require(${below});\n${handed.map(({ exported, inner }) => `exports.${exported} = ${variable}.${inner};\n`).join("")}`;
    case "by hand, a literal of what was taken apart":
      return (
        `const { ${handed.map(({ inner }) => (inner === "default" ? "default: whole" : inner)).join(", ")} } = require(${below});\n` +
        `module.exports = { ${handed.map(({ exported, inner }) => (inner === "default" ? `${exported}: whole` : exported === inner ? inner : `${exported}: ${inner}`)).join(", ")} };\n`
      );
    case "by hand, getters in a literal":
      return `const ${variable} = require(${below});\nmodule.exports = {\n${handed.map(({ exported, inner }) => `  get ${exported}() {\n    return ${variable}.${inner};\n  },\n`).join("")}};\n`;
    case "by hand, getters that are not listed":
      return (
        `"use strict";\n${own}var ${variable} = require(${below});\n` +
        handed
          .map(
            ({ exported, inner }) =>
              `Object.defineProperty(exports, "${exported}", { get: function () { return ${variable}.${inner}; } });\n`,
          )
          .join("")
      );
  }
}

const carriesEverything = (corner: Corner) => /a star|the whole|Object\.assign|a spread/.test(corner);
/** Files from which TypeScript reads the names where it reads JavaScript. */
const isInferred = (corner: Corner) =>
  /^(?:TypeScript, (?:names|stores)|Babel, names|by hand, (?:stores|getters that are not listed))$/.test(corner);

/** How a name is reached from outside a module: `import { exported }` and then `.deeper`. */
type Road = { exported: string; deeper: string[] };

export function generate(
  random: Random,
  corner: Corner,
  lacks = false,
  isWider = false,
  isQuiet = false,
): { file: string; text: string; files: Record<string, string> } {
  // The relations first.
  const levels = random.pick([1, 1, 2, 2, 3]);
  const isAlike = random.chance(0.6);
  const isMarked = random.chance(0.6);
  const saysVoid = random.chance(0.6);
  const watchesDefault = !corner.endsWith("a namespace") && random.chance(isWider ? 0.7 : 0.2);
  const kind = random.pick(watchesDefault ? kinds.filter(each => each !== "Color" && each !== "count") : kinds);
  const secondKind = random.pick(kinds.filter(each => each !== kind && each !== "count"));
  const last = random.weighted([
    [10, "CommonJS"],
    [lacks ? 0 : 1, "an ES module"],
    [lacks || watchesDefault || !["sides", "label", "options", "list"].includes(kind) ? 0 : 1, "JSON"],
  ] as const);
  const lastToolDrawn = random.chance(0.6)
    ? (corner.split(", ")[0] as Tool)
    : random.pick(["TypeScript", "Babel", "swc", "esbuild", "by hand"] as const);
  // What is drawn only where `isWider`: the earlier seeds stay as they are.
  const lastTool = isWider && random.chance(0.5) ? "by hand" : lastToolDrawn;
  const hasInterop = !isWider || random.chance(0.3);
  const isRenamed = /names|stores|literal|getters/.test(corner) && !watchesDefault && random.chance(0.15);
  const lies = random.weighted([
    [isQuiet ? 0 : 4, "the project"],
    [4, "a package"],
    [last === "CommonJS" ? 2 : 0, "two packages"],
  ] as const);
  const mainEnding = random.weighted([
    [5, "ts"],
    [4, "mjs"],
    [lacks ? 0 : 1, "cjs"],
  ] as const);
  // `bun run` finds no name that is not listed, and an executable may: such names are read off an object.
  const isListed = !corner.endsWith("not listed");
  const barrelsDrawn = random.weighted([
    [3, 0],
    [5, 1],
    [3, 2],
    [1, 3],
  ] as const);
  const barrels = isListed ? barrelsDrawn : 0;
  const barrelEnding =
    mainEnding === "cjs" ? "mjs" : random.chance(0.8) ? mainEnding : mainEnding === "ts" ? "mjs" : "ts";
  const isChecked = mainEnding === "ts" || (barrels > 0 && barrelEnding === "ts");
  const chainOfCorners = Array.from({ length: levels }, (_, at) =>
    at === 0 || isAlike
      ? corner
      : random.pick(corners.filter(each => !each.endsWith("a namespace") && !each.endsWith("not listed"))),
  );
  const mayBeInferred =
    !lacks &&
    lies === "the project" &&
    last === "CommonJS" &&
    !watchesDefault &&
    kind !== "Color" &&
    chainOfCorners.every(isInferred) &&
    /TypeScript|Babel/.test(lastTool);
  const declarations = random.weighted([
    [lacks ? 0 : 4, "a file for each file"],
    [lacks ? 0 : 3, "one file for all"],
    [4, "something else"],
    [2, "something invalid beside it"],
    [1, "something invalid"],
    [3, "none"],
    [mayBeInferred && isChecked ? 3 : 0, "inferred"],
  ] as const);
  const isRolledUp = declarations === "one file for all" || last !== "CommonJS" || random.chance(0.4);
  const hider = random.pick(["// @ts-nocheck", "// @ts-ignore"] as const);
  const cycle = random.weighted([
    [lacks ? 60 : 12, "none"],
    [last === "CommonJS" ? 4 : 0, "the last file requires the first"],
    [barrels > 0 && barrelEnding === mainEnding ? 3 : 0, "an ES module imports the importer"],
    [barrels > 0 && last === "CommonJS" && lies === "the project" ? 2 : 0, "the last file requires the ES module"],
  ] as const);
  const secondDrawn = random.weighted([
    [lacks ? 30 : 6, "none"],
    [1, "the same name on the same road"],
    [1, "the same name from the first CommonJS file"],
    [2, "the other name from the first CommonJS file"],
    [barrels > 0 ? 1 : 0, "the other name on the same road"],
    [last === "CommonJS" && lies !== "two packages" ? 1 : 0, "the same name from the last file"],
    [1, "the namespace of the first CommonJS file"],
  ] as const);
  // Where two roads lead into a ring of CommonJS files, plain Bun enters it now by the one and now by the other.
  const second =
    (secondDrawn === "the same name from the last file" && cycle.startsWith("the last file")) ||
    (!isListed && /CommonJS file$|same road$/.test(secondDrawn) && !secondDrawn.startsWith("the namespace"))
      ? "none"
      : secondDrawn;
  const isSecondAhead = random.chance(0.5);
  const loops = random.chance(0.2);
  const isStrict = random.chance(0.8);

  const files: Record<string, string> = {};

  // The CommonJS files, from the last to the first.
  const packageName = random.pick(["a-package", "@some/package"]);
  const ending =
    lies === "the project" ? random.pick([".cjs", ".cjs", ".js"]) : random.pick([".js", ".js", ".js", ".cjs"]);
  const folder =
    lies === "the project" ? random.pick(["", "dist/"]) : `node_modules/${packageName}/${random.pick(["", "lib/"])}`;
  const bases = ["index", "middle", "lower"].slice(0, levels);
  const lastFolder = lies === "two packages" ? "node_modules/another-package/" : folder;
  const lastBase = lies === "two packages" ? "index" : "inner";
  const lastEnding = last === "an ES module" ? ".mjs" : last === "JSON" ? ".json" : ending;
  const saysEnding = ending === ".cjs" || random.chance(0.3);
  const toBelow = (at: number) =>
    at + 1 < levels
      ? `./${bases[at + 1]}${saysEnding ? ending : ""}`
      : lies === "two packages"
        ? "another-package"
        : `./${lastBase}${saysEnding || lastEnding !== ending ? lastEnding : ""}`;
  const declarationEnding = (of: string) => (of === ".cjs" ? ".d.cts" : of === ".mjs" ? ".d.mts" : ".d.ts");

  const watched: Item = { exported: watchesDefault ? "default" : kind, kind };
  const other: Item = { exported: secondKind, kind: secondKind };
  const items = random.chance(0.5) ? [watched, other] : [other, watched];
  const there = lacks ? [other] : items;
  const lastPath = `${lastFolder}${lastBase}${lastEnding}`;
  if (last === "JSON")
    files[lastPath] = `{ ${there
      .filter(item => values[item.kind])
      .map(item => `"${item.exported}": ${item.kind === "options" ? `{ "a": 1 }` : values[item.kind]}`)
      .join(", ")} }\n`;
  else if (last === "an ES module")
    files[lastPath] = there
      .map(item => {
        const head = item.exported === "default" ? "export default" : "export";
        if (item.kind === "make") return `${head} ${functionOf(item.kind, "  ")}\n`;
        if (item.kind === "Shape") return `${head} ${classOf(item.kind, "  ")}\n`;
        if (item.kind === "Color") return `export const Color = { Red: 0, Green: 1, 0: "Red", 1: "Green" };\n`;
        if (item.kind === "count")
          return `export let count = 1;\nglobalThis.change = function () {\n  count += 10;\n};\n`;
        return item.exported === "default"
          ? `export default ${values[item.kind]};\n`
          : `export const ${item.exported} = ${values[item.kind]};\n`;
      })
      .join("");
  else files[lastPath] = lastFile(lastTool, there, lastBase, random, isMarked);
  // JSON holds neither a function nor a class nor an enum.
  const hasOther = last !== "JSON" || values[secondKind] !== undefined;
  if (lacks && lastTool === "by hand" && random.chance(0.4))
    files[lastPath] += `if (globalThis.nobodySetsThis) exports.${watched.exported} = 1;\n`;

  let road: Road = { exported: watched.exported, deeper: [] };
  let otherRoad: Road = { exported: other.exported, deeper: [] };
  /** For each CommonJS file that hands names on, what a declaration file beside it says. */
  const besideEach: string[] = [];
  for (let at = levels - 1; at >= 0; at--) {
    const here = chainOfCorners[at];
    const below = JSON.stringify(toBelow(at));
    const variable = at + 1 < levels ? bases[at + 1] : lies === "two packages" ? "another_package" : lastBase;
    if (here.endsWith("a namespace")) {
      files[`${folder}${bases[at]}${ending}`] = handsOn(
        here,
        below,
        variable,
        bases[at],
        [],
        isMarked,
        saysVoid,
        hasInterop,
      );
      besideEach[at] = `export * as inner from ${below};\n`;
      road = { exported: "inner", deeper: [road.exported, ...road.deeper] };
      otherRoad = { exported: "inner", deeper: [otherRoad.exported, ...otherRoad.deeper] };
      continue;
    }
    const renamed =
      isRenamed && at === 0 && !carriesEverything(here) && road.exported !== "inner" ? "renamed" : road.exported;
    const handed: Handed[] = [{ exported: renamed, inner: road.exported }];
    if (hasOther && otherRoad.exported !== road.exported)
      handed.push({ exported: otherRoad.exported, inner: otherRoad.exported });
    files[`${folder}${bases[at]}${ending}`] = handsOn(
      here,
      below,
      variable,
      bases[at],
      handed,
      isMarked,
      saysVoid,
      hasInterop,
    );
    besideEach[at] = carriesEverything(here)
      ? `export * from ${below};\n${road.exported === "default" ? `export { default } from ${below};\n` : ""}`
      : `export { ${handed.map(({ exported, inner }) => (exported === inner ? inner : `${inner} as ${exported}`)).join(", ")} } from ${below};\n`;
    road = { ...road, exported: renamed };
  }
  /** The roads as they are at the first CommonJS file. */
  const [roadAtLibrary, otherRoadAtLibrary] = [road, otherRoad];

  if (lies !== "the project") {
    const main = `./${folder.slice(`node_modules/${packageName}/`.length)}index${ending}`;
    const types = main.slice(0, -ending.length) + declarationEnding(ending);
    files[`node_modules/${packageName}/package.json`] =
      JSON.stringify(
        {
          name: packageName,
          version: "1.0.0",
          ...random.pick([
            { main },
            { main, types },
            { type: "commonjs", main, typings: types },
            { exports: { ".": { types, require: main, default: main }, "./*": "./*" } },
            { main, exports: { ".": { types, default: main }, "./*": "./*" } },
          ]),
        },
        null,
        2,
      ) + "\n";
    if (lies === "two packages")
      files["node_modules/another-package/package.json"] =
        JSON.stringify({ name: "another-package", version: "2.0.0", main: `./index${ending}` }, null, 2) + "\n";
  } else if (ending === ".js" && folder && random.chance(0.5))
    files[`${folder}package.json`] = `{ "type": "commonjs" }\n`;

  // What the declarations say.
  const truth: Said = saidOf[kind];
  let said: Said | undefined =
    declarations === "none" || declarations === "something invalid"
      ? undefined
      : declarations === "something else" && !lacks
        ? random.chance(0.5)
          ? random.pick(nearly[kind])
          : saidOf[random.pick(kinds.filter(each => saidOf[each].uses !== truth.uses && each !== "Color"))]
        : truth;
  // A constant enum is no value: it cannot be the type of a constant, and nothing can be looked up in it.
  const isConstant = (what: Said | undefined) => !!what && what.declare("x").includes(" const enum ");
  if (isConstant(said) && (isRolledUp || road.deeper.length > 0)) said = nearly.Color[0];
  const isConstantEnum = isConstant(said);
  if (declarations !== "none" && declarations !== "inferred") {
    const declared = said ?? {
      declare: (name: string) => `export declare const ${name}: NobodyDeclaresThis;`,
      type: "NobodyDeclaresThis",
      uses: truth.uses,
    };
    const more =
      declarations === "something invalid beside it"
        ? "export declare const broken: NobodyDeclaresThis<number>;\n"
        : "";
    const through = (deeper: string[], type: string) =>
      deeper.reduceRight((inner, name) => `{ ${name}: ${inner} }`, type);
    if (isRolledUp)
      files[`${folder}index${declarationEnding(ending)}`] =
        more +
        (road.deeper.length
          ? `export declare const ${road.exported}: ${through(
              road.deeper.slice(0, -1),
              `{ ${road.deeper.at(-1)}: ${declared.type}${hasOther ? `; ${otherRoad.deeper.at(-1)}: ${saidOf[secondKind].type}` : ""} }`,
            )};\n`
          : `${declareAs(declared, road.exported)}\n${hasOther ? `${saidOf[secondKind].declare(otherRoad.exported)}\n` : ""}`);
    else {
      besideEach.forEach(
        (text, at) => (files[`${folder}${bases[at]}${declarationEnding(ending)}`] = (at === 0 ? more : "") + text),
      );
      files[`${lastFolder}${lastBase}${declarationEnding(lastEnding)}`] = items
        .map(item => `${declareAs(item === watched ? declared : saidOf[item.kind], item.exported)}\n`)
        .join("");
    }
  }

  // The ES side.
  const isTyped = (of: string) => of === "ts";
  const library = JSON.stringify(
    lies !== "the project"
      ? packageName
      : ending === ".js" && folder && random.chance(0.3)
        ? `./${folder.slice(0, -1)}`
        : `./${folder}index${ending === ".js" && random.chance(0.3) ? "" : ending}`,
  );
  const toModule = (from: string, name: string, to: string) =>
    JSON.stringify(isTyped(from) && isTyped(to) ? `./${name}` : `./${name}.${to}`);
  const sees = declarations !== "none";
  /** Ahead of a line of TypeScript that names what no declaration knows. */
  const ignore = (of: string) => (isTyped(of) && !sees && hider === "// @ts-ignore" ? "// @ts-ignore\n" : "");
  const top = (of: string) => (isTyped(of) && !sees && hider === "// @ts-nocheck" ? "// @ts-nocheck\n" : "");
  let trueUses: keyof typeof usesOf = truth.uses;
  let isSnapshot = false;
  const barrelNames = ["barrel", "second-barrel", "third-barrel"].slice(0, barrels);
  for (let at = barrels - 1; at >= 0; at--) {
    const of = barrelEnding;
    const isOverCommonJS = at === barrels - 1;
    const source = isOverCommonJS ? library : toModule(of, barrelNames[at + 1], of);
    const name = road.exported;
    const isDefault = name === "default";
    const mine = ignore(of);
    const carriesOther = hasOther && otherRoad.exported !== name;
    const alsoOther =
      carriesOther && otherRoad.exported !== "default"
        ? `${mine}export { ${otherRoad.exported} } from ${source};\n`
        : "";
    const form = random.weighted([
      [isDefault ? 0 : 8, "export *"],
      [3, "export { x } from"],
      [isDefault ? 0 : 1, "under another name"],
      [1, "export * as"],
      [2, "imported and exported"],
      [isDefault || isConstantEnum ? 0 : 1, "read off the namespace"],
      [isOverCommonJS && !isDefault && !isConstantEnum && declarations !== "inferred" ? 1 : 0, "read off the default"],
      [isDefault ? 2 : 0, "from the default"],
      [isDefault || isConstantEnum ? 0 : 1, "to the default"],
      [isDefault ? 0 : 1, "a star beside a name of its own"],
      [isDefault ? 0 : 1, "a star beside another star"],
      [isDefault || road.deeper.length ? 0 : 1, "a star beside a name that hides it"],
    ] as const);
    let text: string;
    switch (form) {
      case "export *":
        text = `${mine}export * from ${source};\n`;
        break;
      case "export { x } from":
        text = `${mine}export { ${name} } from ${source};\n${alsoOther}`;
        break;
      case "under another name":
        text = `${mine}export { ${name} as taken${at} } from ${source};\n${alsoOther}`;
        if (otherRoad.exported === name) otherRoad = { ...otherRoad, exported: `taken${at}` };
        road = { ...road, exported: `taken${at}` };
        break;
      case "export * as":
        text = `${mine}export * as all${at} from ${source};\n`;
        road = { exported: `all${at}`, deeper: [name, ...road.deeper] };
        otherRoad = { exported: `all${at}`, deeper: [otherRoad.exported, ...otherRoad.deeper] };
        break;
      case "imported and exported":
        text = isDefault
          ? `${mine}import whole from ${source};\nexport default whole;\n${alsoOther}`
          : `${mine}import { ${name} } from ${source};\nexport { ${name} };\n${alsoOther}`;
        if (isDefault) isSnapshot = true;
        break;
      case "read off the namespace":
        text = `${mine}import * as all from ${source};\n${mine}export const ${name} = all.${name};\n${alsoOther}`;
        isSnapshot = true;
        break;
      case "read off the default":
        text = `${mine}import whole from ${source};\n${mine}export const ${name} = whole.${name};\n${alsoOther}`;
        isSnapshot = true;
        break;
      case "from the default":
        text = `${mine}export { default as taken${at} } from ${source};\n${alsoOther}`;
        if (otherRoad.exported === name) otherRoad = { ...otherRoad, exported: `taken${at}` };
        road = { ...road, exported: `taken${at}` };
        break;
      case "to the default":
        text = `${mine}export { ${name} as default } from ${source};\n${alsoOther}`;
        if (otherRoad.exported === name) otherRoad = { ...otherRoad, exported: "default" };
        road = { ...road, exported: "default" };
        break;
      case "a star beside a name of its own":
        text = `${mine}export * from ${source};\nexport const own${at} = ${at + 5};\n`;
        break;
      case "a star beside another star":
        files[`beside${at}.${of}`] = `export const beside${at} = ${at + 7};\n`;
        text = random.chance(0.5)
          ? `${mine}export * from ${source};\nexport * from ${toModule(of, `beside${at}`, of)};\n`
          : `export * from ${toModule(of, `beside${at}`, of)};\n${mine}export * from ${source};\n`;
        break;
      case "a star beside a name that hides it":
        text = `${mine}export * from ${source};\nexport const ${name} = "text";\n`;
        said = saidOf.label;
        trueUses = "text";
        isSnapshot = true;
        break;
    }
    files[`${barrelNames[at]}.${of}`] = top(of) + text;
  }
  const isHidden = trueUses !== truth.uses || (isSnapshot && said === saidOf.label && kind !== "label");

  // Who imports.
  const of = mainEnding;
  const source = barrels ? toModule(of, "barrel", barrelEnding) : library;
  // TypeScript that imports JavaScript of the project reads it.
  const readsJavaScript = declarations === "inferred" || (of === "ts" && barrels > 0 && barrelEnding === "mjs");
  const mine = ignore(of);
  const isDefault = road.exported === "default";
  const reach =
    of === "cjs"
      ? "require"
      : random.weighted([
          // Whether a name is there is asked where it is imported by name.
          [!isListed ? 0 : lacks ? 40 : 6, "by name"],
          [isListed ? 1 : 0, "under another name"],
          [3, "the namespace"],
          [
            !barrels && !isDefault && !isConstantEnum && declarations !== "inferred" ? (isListed ? 2 : 12) : 0,
            "the default",
          ],
          [isConstantEnum || !isListed ? 0 : 1, "by name and the namespace"],
          [of === "mjs" ? 1 : 0, "require"],
          [isConstantEnum || cycle === "an ES module imports the importer" ? 0 : 1, "import()"],
        ] as const);
  const head: string[] = [];
  const deeper = road.deeper.map(name => `.${name}`).join("");
  const names: string[] = [];
  /** What holds all the names, if the importer has it. */
  let holder: string | undefined;
  if (reach === "by name" || reach === "by name and the namespace") {
    head.push(isDefault ? `${mine}import taken from ${source};` : `${mine}import { ${road.exported} } from ${source};`);
    names.push((isDefault ? "taken" : road.exported) + deeper);
  }
  if (reach === "under another name") {
    head.push(`${mine}import { ${road.exported} as another } from ${source};`);
    names.push(`another${deeper}`);
  }
  if (reach === "the namespace" || reach === "by name and the namespace") {
    head.push(`${mine}import * as everything from ${source};`);
    names.push(`everything.${road.exported}${deeper}`);
    holder = "everything";
  }
  if (reach === "the default") {
    head.push(`${mine}import whole from ${source};`);
    names.push(`whole.${road.exported}${deeper}`);
    holder = "whole";
  }
  if (reach === "require") {
    head.push(`const required = require(${source});`);
    names.push(`required.${road.exported}${deeper}`);
    holder = "required";
  }
  if (reach === "import()") {
    head.push(`${mine}const later = await import(${source});`);
    names.push(`later.${road.exported}${deeper}`);
    holder = "later";
  }
  const typed = isTyped(of);
  const anything = (text: string) => (typed ? `(globalThis as any).${text}` : `globalThis.${text}`);

  if (cycle === "the last file requires the first") {
    const first = lies === "two packages" ? packageName : `./index${ending}`;
    const reads = `try {\n  globalThis.seen = typeof require(${JSON.stringify(first)}).${roadAtLibrary.exported};\n} catch (error) {\n  globalThis.seen = error.constructor.name;\n}\n`;
    files[lastPath] = random.chance(0.5)
      ? files[lastPath] + reads
      : files[lastPath].replace(/^(?:"use strict";\n+)?/, strict => strict + reads);
  }
  if (cycle === "the last file requires the ES module")
    files[lastPath] +=
      `try {\n  globalThis.seen = Object.keys(require(${JSON.stringify(`${folder ? "../" : "./"}barrel.${barrelEnding}`)})).join();\n} catch (error) {\n  globalThis.seen = error.constructor.name;\n}\n`;
  if (cycle === "an ES module imports the importer") {
    files[`barrel.${barrelEnding}`] +=
      `import { here } from ${toModule(barrelEnding, "main", of)};\nexport const read = () => here;\n`;
    head.push(`import { read } from ${source};`, `export const here = "the importer";`);
  }

  if (second !== "none") {
    const secondEnding = of === "cjs" ? "mjs" : of;
    const its = ignore(secondEnding);
    const byName = (to: Road, where: string) => {
      const [taken, path] = [
        to.exported === "default" ? "taken" : `{ ${to.exported} }`,
        to.deeper.map(name => `.${name}`).join(""),
      ];
      return `${its}import ${taken} from ${where};\n${its}console.log("second", typeof ${to.exported === "default" ? "taken" : to.exported}${path});\n`;
    };
    const secondSource = barrels ? toModule(secondEnding, "barrel", barrelEnding) : library;
    const lastFromOutside = JSON.stringify(
      lies === "the project"
        ? `./${lastPath}`
        : `${packageName}/${lastPath.slice(`node_modules/${packageName}/`.length)}`,
    );
    const text = {
      "the same name on the same road": () => byName(road, secondSource),
      "the same name from the first CommonJS file": () => byName(roadAtLibrary, library),
      "the other name from the first CommonJS file": () =>
        byName(hasOther ? otherRoadAtLibrary : roadAtLibrary, library),
      "the other name on the same road": () => byName(hasOther ? otherRoad : road, secondSource),
      "the same name from the last file": () => byName({ exported: watched.exported, deeper: [] }, lastFromOutside),
      "the namespace of the first CommonJS file": () =>
        `${its}import * as everything from ${library};\nconsole.log("second", Object.keys(everything).join());\n`,
    }[second]();
    // A constant enum is no value, and one file of declarations for all says nothing about the last file.
    const isUnchecked = isConstantEnum || second === "the same name from the last file";
    files[`second.${secondEnding}`] =
      (isTyped(secondEnding) && isUnchecked ? "// @ts-nocheck\n" : top(secondEnding)) + text;
    const line = of === "cjs" ? `require("./second.mjs");` : `import ${toModule(of, "second", secondEnding)};`;
    if (isSecondAhead) head.unshift(line);
    else head.push(line);
  }

  // What is done.
  const isBound = typed && sees && !!said;
  const allowed = isBound ? said!.uses : isHidden || !said || random.chance(0.7) ? trueUses : said.uses;
  const fits = usesOf[allowed]
    .filter(use => !isConstantEnum || /^\[?\$\.(?:Red|Green)[^[]*$/.test(use))
    // A class below what has an invalid type has no members for TypeScript.
    .filter(use => !typed || declarations !== "something invalid" || !use.includes("class extends"));
  const lines: string[] = [];
  const attempt = (label: string, use: string) => {
    const body =
      loops && !use.includes("class extends")
        ? [
            "  let result;",
            `${mine && "  // @ts-ignore\n"}  for (let turn = 0; turn < 10000; turn++) result = ${use};`,
            `  console.log("${label}", show(result));`,
          ]
        : [`${mine && "  // @ts-ignore\n"}  console.log("${label}", show(${use}));`];
    lines.push("try {", ...body, "} catch (error) {", `  console.log("${label}", "THROWS", threw(error));`, "}");
  };
  const literal = isBound && /^[0-9"]/.test(said!.type) ? said!.type : allowed === "text" ? `"text"` : "4";
  const drawn = random.sample(fits, random.between(2, 4)).map(use => use.replaceAll("§", literal));
  names.forEach((name, which) => drawn.forEach((use, at) => attempt(`${which}.${at}`, use.replaceAll("$", name))));
  if (holder && random.chance(0.6)) attempt("keys", `Object.keys(${holder}).join()`);
  if (holder && random.chance(0.3))
    attempt("has", `Reflect.has(${holder}, "default") + " " + Reflect.has(${holder}, "__esModule")`);
  if (kind === "count" && !lacks) {
    lines.push(`${anything("change")}();`);
    names.forEach((name, which) => attempt(`${which}, changed`, drawn[0].replaceAll("$", name)));
  }
  if (cycle.startsWith("the last file")) lines.push(`console.log("seen", ${anything("seen")});`);
  if (cycle === "an ES module imports the importer") lines.push(`console.log("read", read());`);

  const unknown = typed ? ": unknown" : "";
  const helpers = [
    `function show(value${unknown}) {`,
    `  if (typeof value === "function") return "function " + value.name;`,
    `  return typeof value === "string" && /function|class|=>/.test(value) ? "the text of a function" : value;`,
    "}",
    `function threw(error${unknown}) {`,
    "  for (const kind of [TypeError, ReferenceError, RangeError, SyntaxError]) if (error instanceof kind) return kind.name;",
    "  return typeof error;",
    "}",
  ];

  if (isChecked)
    files["tsconfig.json"] =
      JSON.stringify(
        {
          compilerOptions: {
            target: "esnext",
            module: random.pick(["preserve", "esnext"]),
            moduleResolution: "bundler",
            noEmit: true,
            strict: isStrict,
            types: [],
            ...(declarations.startsWith("something invalid") || random.chance(0.3) ? { skipLibCheck: true } : {}),
            ...(readsJavaScript ? { allowJs: true } : {}),
            ...(last === "JSON" ? { resolveJsonModule: true } : {}),
          },
        },
        null,
        2,
      ) + "\n";
  // Where `isQuiet`, every package says that its files have no side effects. They have none but in the last file, whose name is taken.
  if (isQuiet)
    for (const [path, text] of Object.entries(files))
      if (path.startsWith("node_modules/") && path.endsWith("/package.json"))
        files[path] = JSON.stringify({ ...JSON.parse(text), sideEffects: false }, null, 2) + "\n";
  const isModule = head.some(line => /^(?:\/\/ @ts-ignore\n)?(?:import|export) /.test(line));
  return {
    file: `main.${of}`,
    text:
      top(of) + [...head, ...helpers, ...lines, ...(isModule || of === "cjs" ? [] : ["export {};"])].join("\n") + "\n",
    files,
  };
}
