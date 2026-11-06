// Small programs with one cycle: the program takes a name through a file that hands it on (`corners`: how), the file below that one asks for a file above itself while all of them are still being loaded, and
// reads there what it can. It keeps what it got and reads it again when everything is loaded.
//
//   handed on by   a getter over a variable that is declared ahead of it or behind it, by `var`, `let` or `const`, as TypeScript, Babel and swc emit it; the getter returns a name of the file below or the whole
//                  of it; a store ahead of and behind the `require`; `exports` replaced behind the `require`; helpers for `export *`; a `require` inside the getter; an ES module that exports it again
//   asked back     the file that hands on, the ES module between it and the program, or the program itself; by `require`, or by an import where the file below is an ES module
//   read there     the keys, the kind of the name, `in`, the descriptor, the name itself
//   taken          by name, as the namespace, as the default, by `require` or `import()`; straight or through `export { } from` or `export * from`
//
// One road leads into the cycle. Every read stands in a try. The executable prints what plain Bun prints and ends as it ends.
import type { Random } from "./random";

const mark = `Object.defineProperty(exports, "__esModule", { value: true });\n`;
const getter = (body: string) =>
  `Object.defineProperty(exports, "x", { enumerable: true, get: function () { return ${body}; } });\n`;
const exportStar = `var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {\n    if (k2 === undefined) k2 = k;\n    var desc = Object.getOwnPropertyDescriptor(m, k);\n    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {\n      desc = { enumerable: true, get: function() { return m[k]; } };\n    }\n    Object.defineProperty(o, k2, desc);\n}) : (function(o, m, k, k2) {\n    if (k2 === undefined) k2 = k;\n    o[k2] = m[k];\n}));\nvar __exportStar = (this && this.__exportStar) || function(m, exports) {\n    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);\n};\n`;

/** The text of the file that hands `x` on; `¶` is the file below. An ES module where the name says so. */
const handsOn = {
  "var ahead of the getter": `var inner = require(¶);\n${getter("inner.x")}`,
  "const ahead of the getter": `const inner = require(¶);\n${getter("inner.x")}`,
  "var behind the getter": `${getter("inner.x")}var inner = require(¶);\n`,
  "let behind the getter": `${getter("inner.x")}let inner = require(¶);\n`,
  "const behind the getter": `${getter("inner.x")}const inner = require(¶);\n`,
  "the whole, var behind the getter": `${getter("inner")}var inner = require(¶);\n`,
  "the whole, const behind the getter": `${getter("inner")}const inner = require(¶);\n`,
  "the whole, const ahead of the getter": `const inner = require(¶);\n${getter("inner")}`,
  "as TypeScript emits it": `"use strict";\n${mark}exports.x = void 0;\nvar inner_1 = require(¶);\n${getter("inner_1.x")}`,
  "as Babel emits it": `"use strict";\n\n${mark}${getter("_inner.x")}var _inner = require(¶);\n`,
  "as swc emits it": `"use strict";\n${mark}Object.defineProperty(exports, "x", {\n    enumerable: true,\n    get: function() {\n        return _inner.x;\n    }\n});\nconst _inner = require(¶);\n`,
  "a star as TypeScript emits it": `"use strict";\n${exportStar}${mark}__exportStar(require(¶), exports);\n`,
  "a star as Babel emits it": `"use strict";\n\n${mark}var _inner = require(¶);\nObject.keys(_inner).forEach(function (key) {\n  if (key === "default" || key === "__esModule") return;\n  if (key in exports && exports[key] === _inner[key]) return;\n  Object.defineProperty(exports, key, {\n    enumerable: true,\n    get: function () {\n      return _inner[key];\n    }\n  });\n});\n`,
  "a store behind the require": `var inner = require(¶);\nexports.x = inner.x;\n`,
  "a store ahead of and behind the require": `exports.x = "early";\nvar inner = require(¶);\nexports.x = inner.x;\n`,
  "void ahead of the require": `exports.x = void 0;\nvar inner = require(¶);\nexports.x = inner.x;\n`,
  "exports replaced behind the require": `var inner = require(¶);\nmodule.exports = { x: inner.x };\n`,
  "exports replaced ahead of the require": `module.exports = { x: "early" };\nvar inner = require(¶);\nmodule.exports.x = inner.x;\n`,
  "the whole is handed on": `module.exports = require(¶);\n`,
  "a getter in a literal ahead of the require": `module.exports = {\n  get x() {\n    return inner.x;\n  },\n};\nconst inner = require(¶);\n`,
  "the getter requires": getter("require(¶).x"),
  "the getter requires, and the file is required behind it": `${getter("require(¶).x")}require(¶);\n`,
  "an ES module, export { } from": `export { x } from ¶;\n`,
  "an ES module, export * from": `export * from ¶;\n`,
  "an ES module, an import that is exported": `import { x } from ¶;\nexport { x };\n`,
  "an ES module, a constant of its own": `import { x as below } from ¶;\nexport const x = below;\n`,
  "an ES module, the default taken apart": `import inner from ¶;\nexport const x = inner.x;\n`,
} as const;
export const corners = Object.keys(handsOn) as (keyof typeof handsOn)[];

export function generate(
  random: Random,
  corner: (typeof corners)[number],
): { file: string; text: string; files: Record<string, string> } {
  // The relations first.
  const isAboveAModule = corner.startsWith("an ES module");
  const isBelowAModule = corner !== "an ES module, the default taken apart" && random.chance(0.25);
  const ending = random.weighted([
    [6, "mjs"],
    [2, "ts"],
    [1, "cjs"],
  ] as const);
  const isTyped = ending === "ts";
  const side = random.weighted([
    [4, "none"],
    [3, "export * from"],
    [3, "export { } from"],
  ] as const);
  const back = random.weighted([
    [5, "the file that hands on"],
    [side === "none" ? 0 : 4, "the file between"],
    [1, "the program"],
  ] as const);
  const isStoredAhead = random.chance(0.6);
  const reads = random.sample(
    ["the keys", "the kind", "in", "the descriptor", "the name"] as const,
    random.between(1, 3),
  );
  const value = random.pick(["1", `"text"`, "{ a: 1 }", "function made() {\n  return 1;\n}"]);

  const above = isAboveAModule ? "index.mjs" : "index.cjs";
  const below = isBelowAModule ? "inner.mjs" : "inner.cjs";
  const barrelEnding = ending === "cjs" ? "mjs" : ending;
  const files: Record<string, string> = {};
  files[above] = handsOn[corner].replaceAll("¶", JSON.stringify(`./${below}`));
  const target =
    back === "the file that hands on"
      ? `./${above}`
      : back === "the file between"
        ? `./barrel.${barrelEnding}`
        : `./main.${ending}`;

  const read = {
    "the keys": `Object.keys(back).sort().join()`,
    "the kind": `typeof back.x`,
    in: `"x" in back`,
    "the descriptor": `Object.keys(Object.getOwnPropertyDescriptor(back, "x") ?? {}).sort().join()`,
    "the name": `typeof back.x === "function" ? back.x.name : String(back.x).length`,
  };
  const tell = (label: string, indent: string) =>
    reads
      .map(
        what =>
          `${indent}try {\n${indent}  console.log("${label}, ${what}:", ${read[what]});\n${indent}} catch (error) {\n${indent}  console.log("${label}, ${what}:", "THROWS", error.constructor.name);\n${indent}}\n`,
      )
      .join("");
  const store = isBelowAModule ? `export const x = ${value};\n` : `exports.x = ${value};\n`;
  files[below] =
    (isBelowAModule
      ? `import * as back from ${JSON.stringify(target)};\n`
      : `${isStoredAhead ? store : ""}let back;\ntry {\n  back = require(${JSON.stringify(target)});\n} catch (error) {\n  console.log("asked back:", "THROWS", error.constructor.name);\n  back = {};\n}\n`) +
    tell("while loading", "") +
    (isBelowAModule || !isStoredAhead ? store : "") +
    `globalThis.later = function () {\n${tell("later", "  ")}};\n`;

  if (isTyped) {
    files[above.replace(/\.(c|m)js$/, ".d.$1ts")] = "export declare const x: unknown;\n";
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
  if (side !== "none")
    files[`barrel.${barrelEnding}`] = `export ${side === "export * from" ? "*" : "{ x }"} from "./${above}";\n`;
  const from = side === "none" ? `"./${above}"` : isTyped ? `"./barrel"` : `"./barrel.${barrelEnding}"`;

  const reach =
    ending === "cjs"
      ? "require"
      : random.weighted([
          [5, "by name"],
          [3, "the namespace"],
          [side === "none" && !isAboveAModule && !isTyped ? 2 : 0, "the default"],
          [back === "the program" ? 0 : 1, "import()"],
        ] as const);
  const head =
    reach === "by name"
      ? `import { x } from ${from};`
      : reach === "the namespace"
        ? `import * as held from ${from};`
        : reach === "the default"
          ? `import held from ${from};`
          : reach === "require"
            ? `const held = require(${from});`
            : `const held = await import(${from});`;
  const name = reach === "by name" ? "x" : "held.x";
  const lines = [
    head,
    // What the file below sees where it asks for the program itself.
    ...(back === "the program"
      ? ending === "cjs"
        ? [`exports.x = "of the program";`]
        : [`export const own = "of the program";`]
      : []),
    "try {",
    `  console.log("taken:", typeof ${name}, typeof ${name} === "function" ? ${isTyped ? `(${name} as any)` : name}.name : String(${name}).length);`,
    "} catch (error) {",
    `  console.log("taken:", "THROWS", error instanceof TypeError ? "TypeError" : error instanceof ReferenceError ? "ReferenceError" : typeof error);`,
    "}",
    ...(reach === "by name" ? [] : [`console.log("keys:", Object.keys(held).sort().join());`]),
    // Where the file below asks for the program, the program runs inside that file, ahead of the function.
    `${isTyped ? "(globalThis as any)" : "globalThis"}.later?.();`,
    ...(reach === "import()" && back !== "the program" ? ["export {};"] : []),
  ];
  return { file: `main.${ending}`, text: lines.join("\n") + "\n", files };
}
