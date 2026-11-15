// Three to five files about what `default` is. The innermost file has a member named `default`, is a single value, or
// has none; `lib.cjs` re-exports it in one of many ways, as compilers emit `export { default } from` or as written by
// hand; importers read it in every way.
import type { Random } from "./random";

const mark = `Object.defineProperty(exports, "__esModule", { value: true });\n`;
const importDefault = `var __importDefault = (this && this.__importDefault) || function (mod) {\n    return (mod && mod.__esModule) ? mod : { "default": mod };\n};\n`;
const interopRequireDefault = `function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }\n`;
const interopRequireDefaultOfSwc = `function _interop_require_default(obj) {\n    return obj && obj.__esModule ? obj : {\n        default: obj\n    };\n}\n`;
const helpersOfEsbuild = `var __create = Object.create;\nvar __defProp = Object.defineProperty;\nvar __getOwnPropDesc = Object.getOwnPropertyDescriptor;\nvar __getOwnPropNames = Object.getOwnPropertyNames;\nvar __getProtoOf = Object.getPrototypeOf;\nvar __hasOwnProp = Object.prototype.hasOwnProperty;\nvar __export = (target, all) => {\n  for (var name in all)\n    __defProp(target, name, { get: all[name], enumerable: true });\n};\nvar __copyProps = (to, from, except, desc) => {\n  if (from && typeof from === "object" || typeof from === "function") {\n    for (let key of __getOwnPropNames(from))\n      if (!__hasOwnProp.call(to, key) && key !== except)\n        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });\n  }\n  return to;\n};\nvar __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(\n  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,\n  mod\n));\nvar __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);\n`;

/**
 * How `lib.cjs` re-exports the member: `§` is its name there, `¶` the dependency. A form that sets `__esModule` itself
 * does not get the flag a second time.
 */
const handsOn = {
  "a getter as TypeScript emits it": `var inner_1 = require(¶);\nObject.defineProperty(exports, "§", { enumerable: true, get: function () { return inner_1.default; } });\n`,
  "a getter with __importDefault": `${importDefault}var inner_1 = require(¶);\nObject.defineProperty(exports, "§", { enumerable: true, get: function () { return __importDefault(inner_1).default; } });\n`,
  "a variable with __importDefault": `${importDefault}const inner_1 = __importDefault(require(¶));\nexports["§"] = inner_1.default;\n`,
  "a getter as Babel emits it": `Object.defineProperty(exports, "§", {\n  enumerable: true,\n  get: function () {\n    return _inner.default;\n  }\n});\nvar _inner = _interopRequireDefault(require(¶));\n${interopRequireDefault}`,
  "a getter as Babel emits it without its helper": `Object.defineProperty(exports, "§", {\n  enumerable: true,\n  get: function () {\n    return _inner.default;\n  }\n});\nvar _inner = require(¶);\n`,
  "a getter as swc emits it": `Object.defineProperty(exports, "§", {\n    enumerable: true,\n    get: function() {\n        return _inner.default;\n    }\n});\nconst _inner = /*#__PURE__*/ _interop_require_default(require(¶));\n${interopRequireDefaultOfSwc}`,
  "a getter as swc emits it without its helper": `Object.defineProperty(exports, "§", {\n    enumerable: true,\n    get: function() {\n        return _inner.default;\n    }\n});\nconst _inner = require(¶);\n`,
  "as esbuild emits it": `${helpersOfEsbuild}var lib_exports = {};\n__export(lib_exports, {\n  "§": () => import_inner.default\n});\nmodule.exports = __toCommonJS(lib_exports);\nvar import_inner = __toESM(require(¶));\n`,
  "as esbuild emits it for Node": `${helpersOfEsbuild}var lib_exports = {};\n__export(lib_exports, {\n  "§": () => import_inner.default\n});\nmodule.exports = __toCommonJS(lib_exports);\nvar import_inner = __toESM(require(¶), 1);\n`,
  "a getter that is not listed": `var inner = require(¶);\nObject.defineProperty(exports, "§", { get: function () { return inner.default; } });\n`,
  "a getter with the key in brackets": `var inner = require(¶);\nObject.defineProperty(exports, "§", { enumerable: true, get: function () { return inner["default"]; } });\n`,
  "a getter in a literal": `var inner = require(¶);\nmodule.exports = {\n  get "§"() {\n    return inner.default;\n  },\n};\n`,
  "a store": `var inner = require(¶);\nexports["§"] = inner.default;\n`,
  "a store of the whole": `exports["§"] = require(¶);\n`,
  "a getter onto the whole": `var inner = require(¶);\nObject.defineProperty(exports, "§", { enumerable: true, get: function () { return inner; } });\n`,
  "a pattern": `const { default: whole } = require(¶);\nmodule.exports = { "§": whole };\n`,
  "a spread": `module.exports = { ...require(¶) };\n`,
  "Object.assign": `Object.assign(exports, require(¶));\n`,
  "the whole": `module.exports = require(¶);\n`,
  "the member is the whole": `module.exports = require(¶).default;\n`,
  "the whole and itself as the member": `module.exports = require(¶);\nmodule.exports.default = module.exports;\n`,
} as const;
export const corners = Object.keys(handsOn) as (keyof typeof handsOn)[];

const values = {
  "a text": { text: `"text"`, type: "string" },
  "a number": { text: "7", type: "number" },
  "a function": { text: "function made() {\n  return 1;\n}", type: "() => number" },
  "a class": { text: "class Made {\n  a = 1;\n}", type: "new () => { a: number }" },
  "an object with the member": { text: `{ default: "deeper", a: 1 }`, type: "{ default: string; a: number }" },
} as const;

export function generate(
  random: Random,
  corner: (typeof corners)[number],
): { file: string; text: string; files: Record<string, string> } {
  // Make the random choices first.
  const kind = random.pick(Object.keys(values) as (keyof typeof values)[]);
  const value = values[kind];
  const below = random.weighted([
    [5, "exports.default"],
    [3, "a literal"],
    [2, "one value"],
    [2, "one value that is its own member"],
    [1, "a getter"],
    [1, "no such member"],
    [3, "export default"],
    [1, "export { x as default }"],
    [1, "an ES module without it"],
    [1, "JSON"],
    [1, "JSON without it"],
  ] as const);
  const isBelowMarked = random.chance(0.4);
  const isAboveMarked = random.chance(0.6);
  const isStrict = random.chance(0.5);
  // A form that re-exports everything adds no name of its own. An import statement finds an unlisted name in an
  // executable but not under `bun run`, so only `default` is used there.
  const givesAName = ![
    "a getter that is not listed",
    "a spread",
    "Object.assign",
    "the whole",
    "the member is the whole",
    "the whole and itself as the member",
  ].includes(corner);
  const name = random.chance(0.75) || !givesAName ? "default" : "taken";
  const hasAnother = random.chance(0.4);
  const ending = random.weighted([
    [5, "mjs"],
    [3, "ts"],
    [1, "cjs"],
  ] as const);
  const isTyped = ending === "ts";
  const side = random.weighted([
    [5, "none"],
    [3, "export { } from"],
    [1, "under another name"],
    [1, "export * from"],
    [1, "an import that is exported"],
    [1, "two in a row"],
  ] as const);
  const second = random.weighted([
    [6, "none"],
    // If a JSON file has the key `default` and is also imported, `require` returns something different under `bun run`
    // than in an executable.
    [below === "an ES module without it" || below === "JSON" ? 0 : 1, "the default of the file below"],
    [1, "the file below is required"],
  ] as const);

  const inner = below.startsWith("JSON")
    ? "./inner.json"
    : below.startsWith("export ") || below.startsWith("an ES")
      ? "./inner.mjs"
      : "./inner.cjs";
  // An object can carry a member; a string or a number cannot.
  const canCarry = kind === "a function" || kind === "a class" || kind === "an object with the member";
  const files: Record<string, string> = {};
  const marked = isBelowMarked ? mark : "";
  const another = hasAnother ? "exports.another = 2;\n" : "";
  files[inner.slice(2)] =
    below === "exports.default"
      ? `${marked}exports.default = ${value.text};\n${another}`
      : below === "a literal"
        ? `module.exports = {\n  ${isBelowMarked ? "__esModule: true,\n  " : ""}default: ${value.text},\n${hasAnother ? "  another: 2,\n" : ""}};\n`
        : below === "one value" || (below === "one value that is its own member" && !canCarry)
          ? `module.exports = ${value.text};\n`
          : below === "one value that is its own member"
            ? `const value = ${value.text};\nmodule.exports = value;\nmodule.exports.default = value;\n${hasAnother ? "module.exports.another = 2;\n" : ""}`
            : below === "a getter"
              ? `${marked}Object.defineProperty(exports, "default", { enumerable: true, get: function () { return ${kind === "a function" || kind === "a class" ? `(${value.text})` : value.text}; } });\n${another}`
              : below === "no such member"
                ? `${marked}exports.another = 2;\n`
                : below === "export default"
                  ? `export default ${value.text}${kind === "a function" || kind === "a class" ? "" : ";"}\n${hasAnother ? "export const another = 2;\n" : ""}`
                  : below === "export { x as default }"
                    ? `const x = ${value.text};\nexport { x as default };\n${hasAnother ? "export const another = 2;\n" : ""}`
                    : below === "an ES module without it"
                      ? "export const another = 2;\n"
                      : below === "JSON"
                        ? `{ "default": "text", "another": 2 }\n`
                        : `{ "another": 2 }\n`;
  const saysTheMarkItself = corner.startsWith("as esbuild");
  files["lib.cjs"] =
    (isStrict ? `"use strict";\n` : "") +
    (isAboveMarked && !saysTheMarkItself ? mark : "") +
    handsOn[corner].replaceAll("§", name).replaceAll("¶", JSON.stringify(inner));

  if (isTyped) {
    files["lib.d.cts"] =
      name === "default"
        ? `declare const whole: unknown;\nexport default whole;\n`
        : `export declare const taken: unknown;\n`;
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
  }

  // The ES modules in between.
  const barrelEnding = ending === "cjs" ? "mjs" : ending;
  const to = (file: string) => JSON.stringify(isTyped ? `./${file}` : `./${file}.${barrelEnding}`);
  let reachedName: string = name;
  const barrel = (from: string, how: typeof side) => {
    if (how === "export { } from") return `export { ${reachedName} } from ${from};\n`;
    if (how === "export * from") return `export * from ${from};\n`;
    if (how === "an import that is exported") {
      const text =
        reachedName === "default"
          ? `import whole from ${from};\nexport default whole;\n`
          : `import { ${reachedName} } from ${from};\nexport default ${reachedName};\n`;
      reachedName = "default";
      return text;
    }
    const text = `export { ${reachedName} as ${reachedName === "default" ? "renamed" : "default"} } from ${from};\n`;
    reachedName = reachedName === "default" ? "renamed" : "default";
    return text;
  };
  let from = `"./lib.cjs"`;
  if (side === "two in a row") {
    files[`second-barrel.${barrelEnding}`] = barrel(
      from,
      random.pick(["export { } from", "under another name"] as const),
    );
    files[`barrel.${barrelEnding}`] = barrel(
      to("second-barrel"),
      random.pick(["export { } from", "under another name"] as const),
    );
    from = to("barrel");
  } else if (side !== "none") {
    files[`barrel.${barrelEnding}`] = barrel(from, side);
    from = to("barrel");
  }
  // `export *` does not re-export the default, and TypeScript knows that.
  const isGone = side === "export * from" && reachedName === "default";

  const reach =
    ending === "cjs"
      ? "require"
      : random.weighted([
          [reachedName === "default" && !isGone ? 6 : 0, "import whole from"],
          [isGone ? 0 : 3, "by name"],
          [3, "the namespace"],
          [2, "import()"],
        ] as const);
  const head: string[] = [];
  let got: string;
  let holder: string | undefined;
  if (reach === "import whole from") {
    head.push(`import whole from ${from};`);
    got = "whole";
  } else if (reach === "by name") {
    head.push(`import { ${reachedName === "default" ? "default as whole" : `${reachedName} as whole`} } from ${from};`);
    got = "whole";
  } else {
    holder = reach === "the namespace" ? "everything" : reach === "require" ? "required" : "later";
    head.push(
      reach === "the namespace"
        ? `import * as everything from ${from};`
        : reach === "require"
          ? `const required = require(${from});`
          : `const later = await import(${from});`,
    );
    got = isTyped ? `(${holder} as any).${reachedName}` : `${holder}.${reachedName}`;
  }
  if (second === "the default of the file below") {
    files[`second.${barrelEnding}`] =
      `${isTyped ? "// @ts-nocheck\n" : ""}import below from ${JSON.stringify(inner)};\nexport const second = typeof below;\n`;
    head.push(
      ending === "cjs" ? `const { second } = require("./second.mjs");` : `import { second } from ${to("second")};`,
    );
  }
  if (second === "the file below is required") {
    files["second.cjs"] = `exports.second = typeof require(${JSON.stringify(inner)}).default;\n`;
    head.push(
      ending === "cjs"
        ? `const { second } = require("./second.cjs");`
        : `${isTyped ? "// @ts-ignore\n" : ""}import { second } from "./second.cjs";`,
    );
  }

  const any = (expression: string) => (isTyped ? `(${expression} as any)` : expression);
  const lines: string[] = [];
  const say = (label: string, expression: string) =>
    lines.push(
      "try {",
      `  console.log("${label}", ${expression});`,
      "} catch (error) {",
      `  console.log("${label}", "THROWS", error instanceof TypeError ? "TypeError" : error instanceof ReferenceError ? "ReferenceError" : typeof error);`,
      "}",
    );
  say("it is", `typeof ${got}`);
  say("its keys", `Object.keys(Object(${got})).sort().join()`);
  say("its member", `typeof ${any(got)}?.default`);
  say(
    "used",
    random.pick([
      `typeof ${got} === "function" ? ${any(got)}.length : String(${got}).length`,
      `typeof ${got} === "function" ? ${any(got)}.name : JSON.stringify(${got})`,
      `${any(got)} + 1 === "text1" || ${any(got)} + 1 === 8`,
    ]),
  );
  if (holder) lines.push(`console.log("keys", Object.keys(${holder}).sort().join(), "default" in ${holder});`);
  if (second !== "none") lines.push(`console.log("second", second);`);
  const isModule = head.some(line => /^(?:\/\/ @ts-ignore\n)?import /.test(line));
  return {
    file: `main.${ending}`,
    text: [...head, ...lines, ...(isModule || ending === "cjs" ? [] : ["export {};"])].join("\n") + "\n",
    files,
  };
}
