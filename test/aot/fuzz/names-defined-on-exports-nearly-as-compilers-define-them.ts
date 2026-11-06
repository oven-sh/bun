// Small programs in which a CommonJS file defines one name, `x`, over a name of the file below it, in one of many ways that are what compilers emit or nearly that (`corners`): other words in the descriptor, another
// function to define it with, another name for `exports`, a variable that is assigned again, a condition, a loop, a value, a setter, a second definition, a store over it, a getter that does more than read, a file
// that is only required when the name is read. Another file takes the name by name, as the namespace, as the default or by `require`, straight or through ES modules, in JavaScript or in TypeScript under a
// declaration file that says `number`, and prints it ahead of and behind a change in the file below, which is a CommonJS file or (`isOverAnESModule`) an ES module. The executable
// prints what plain Bun prints and ends as it ends.
import type { Random } from "./random";

const getter = (words: string, body = "return inner.x;") =>
  `Object.defineProperty(exports, "x", { ${words}get: function () { ${body} } });\n`;
const takes = `var inner = require("./inner.cjs");\n`;

/** The text of the file that defines `x`. */
const definitions = {
  "as TypeScript emits it": takes + getter("enumerable: true, "),
  "the words the other way round": `${takes}Object.defineProperty(exports, "x", { get: function () { return inner.x; }, enumerable: true });\n`,
  "it may be defined again": takes + getter("enumerable: true, configurable: true, "),
  "a method": `${takes}Object.defineProperty(exports, "x", { enumerable: true, get() { return inner.x; } });\n`,
  "an arrow": `${takes}Object.defineProperty(exports, "x", { enumerable: true, get: () => inner.x });\n`,
  "a key in brackets": takes + getter("enumerable: true, ", `return inner["x"];`),
  "a name in brackets": `${takes}Object.defineProperty(exports, ["x"][0], { enumerable: true, get: function () { return inner.x; } });\n`,
  "on module.exports": `${takes}Object.defineProperty(module.exports, "x", { enumerable: true, get: function () { return inner.x; } });\n`,
  "on this": `${takes}Object.defineProperty(this, "x", { enumerable: true, get: function () { return inner.x; } });\n`,
  "Object.defineProperties": `${takes}Object.defineProperties(exports, { x: { enumerable: true, get: function () { return inner.x; } } });\n`,
  "Reflect.defineProperty": `${takes}Reflect.defineProperty(exports, "x", { enumerable: true, get: function () { return inner.x; } });\n`,
  __defineGetter__: `${takes}exports.__defineGetter__("x", function () { return inner.x; });\n`,
  "another name for exports": `${takes}var target = exports;\nObject.defineProperty(target, "x", { enumerable: true, get: function () { return inner.x; } });\n`,
  "another name for Object.defineProperty": `${takes}var define = Object.defineProperty;\ndefine(exports, "x", { enumerable: true, get: function () { return inner.x; } });\n`,
  "a descriptor in a variable": `${takes}var descriptor = { enumerable: true, get: function () { return inner.x; } };\nObject.defineProperty(exports, "x", descriptor);\n`,
  "the variable is assigned again": `${takes}${getter("enumerable: true, ")}inner = require("./other.cjs");\n`,
  "the variable is assigned later": `${takes}${getter("enumerable: true, ")}globalThis.swap = function () {\n  inner = require("./other.cjs");\n};\n`,
  "the file is chosen": `var inner = typeof process === "object" ? require("./inner.cjs") : require("./other.cjs");\n${getter("enumerable: true, ")}`,
  "the variable is declared behind it": `${getter("enumerable: true, ")}const inner = require("./inner.cjs");\n`,
  "under a condition that holds": `${takes}if (typeof process === "object") ${getter("enumerable: true, ")}`,
  "under a condition that fails": `${takes}if (typeof process !== "object") ${getter("enumerable: true, ")}exports.y = inner.y;\n`,
  "in a function": `${takes}function define() {\n  ${getter("enumerable: true, ")}}\ndefine();\n`,
  "in a loop over names": `${takes}["x", "y"].forEach(function (key) {\n  Object.defineProperty(exports, key, { enumerable: true, get: function () { return inner[key]; } });\n});\n`,
  "a value": `${takes}Object.defineProperty(exports, "x", { enumerable: true, value: inner.x });\n`,
  "a value that may be written": `${takes}Object.defineProperty(exports, "x", { enumerable: true, writable: true, value: inner.x });\n`,
  "with a setter": `${takes}Object.defineProperty(exports, "x", { enumerable: true, get: function () { return inner.x; }, set: function (value) { inner.x = value; } });\n`,
  "defined twice":
    takes + getter("enumerable: true, configurable: true, ") + getter("enumerable: true, ", "return inner.y;"),
  "defined and deleted": `${takes}${getter("enumerable: true, configurable: true, ")}delete exports.x;\nexports.y = inner.y;\n`,
  "defined and stored over": `${takes}${getter("enumerable: true, ")}try {\n  exports.x = 5;\n} catch (error) {\n  console.log("the store throws", error.constructor.name);\n}\n`,
  "stored and defined": `${takes}exports.x = 5;\n${getter("enumerable: true, ")}`,
  "the getter counts":
    takes + getter("enumerable: true, ", "globalThis.reads = (globalThis.reads || 0) + 1; return inner.x;"),
  "the getter adds": takes + getter("enumerable: true, ", "return inner.x + 1;"),
  "the getter calls": takes + getter("enumerable: true, ", "return inner.make();"),
  "the getter reads deeper": takes + getter("enumerable: true, ", "return inner.holder.x;"),
  "the getter returns the whole": takes + getter("enumerable: true, ", "return inner;"),
  "the getter reads another name": takes + getter("enumerable: true, ", "return inner.y;"),
  "the getter reads its own exports": `${takes}exports.y = inner.y;\n${getter("enumerable: true, ", "return exports.y;")}`,
  "the getter requires": getter("enumerable: true, ", `return require("./inner.cjs").x;`),
  "required when it is read, as Babel emits it": `function _inner() {\n  const data = require("./inner.cjs");\n  _inner = function () {\n    return data;\n  };\n  return data;\n}\n${getter("enumerable: true, ", "return _inner().x;")}`,
  "exports is replaced behind it": `${takes}${getter("enumerable: true, ")}module.exports = { y: inner.y };\n`,
  "exports is replaced ahead of it": `${takes}module.exports = { y: inner.y };\n${getter("enumerable: true, ")}`,
  "exports is replaced and named again": `${takes}exports = module.exports = { y: inner.y };\n${getter("enumerable: true, ")}`,
  "exports is frozen behind it": `${takes}${getter("enumerable: true, ")}Object.freeze(exports);\n`,
} as const;
export const corners = Object.keys(definitions) as (keyof typeof definitions)[];

export function generate(
  random: Random,
  corner: (typeof corners)[number],
  isOverAnESModule = false,
): { file: string; text: string; files: Record<string, string> } {
  // The relations first.
  const isStrict = random.chance(0.5);
  const isMarked = random.chance(0.5);
  const ending = random.weighted([
    [4, "mjs"],
    [4, "ts"],
    [1, "cjs"],
  ] as const);
  const side = random.weighted([
    [4, "none"],
    [4, "export *"],
    [2, "export { x } from"],
    [1, "export * of export *"],
    [1, "export { x } from a star"],
  ] as const);
  const reach =
    ending === "cjs"
      ? "require"
      : random.weighted([
          [5, "by name"],
          [3, "the namespace"],
          [side === "none" ? 3 : 0, "the default"],
          [2, "by name and the namespace"],
          [1, "import()"],
        ] as const);
  const second = random.weighted([
    [6, "none"],
    [1, "x of the file below"],
    [1, "the file below is required"],
  ] as const);
  const loops = random.chance(0.2);

  const isTyped = ending === "ts";
  const below = isOverAnESModule ? "./inner.mjs" : "./inner.cjs";
  const definition = definitions[corner].replaceAll("./inner.cjs", below);
  const files: Record<string, string> = {
    "lib.cjs":
      // In strict code `this` of a CommonJS file is its exports all the same.
      (isStrict ? `"use strict";\n` : "") +
      (isMarked ? `Object.defineProperty(exports, "__esModule", { value: true });\n` : "") +
      definition,
    [below.slice(2)]: isOverAnESModule
      ? `console.log("the file below runs");\nexport let x = 1;\nexport let y = 2;\nexport function make() {\n  return 3;\n}\nexport const holder = { x: 4 };\nglobalThis.change = function () {\n  x += 10;\n  y += 10;\n  holder.x += 10;\n};\n`
      : `console.log("the file below runs");\nexports.x = 1;\nexports.y = 2;\nexports.make = function () {\n  return 3;\n};\nexports.holder = { x: 4 };\nglobalThis.change = function () {\n  exports.x += 10;\n  exports.y += 10;\n  exports.holder.x += 10;\n};\n`,
  };
  if (definitions[corner].includes("./other.cjs")) files["other.cjs"] = "exports.x = 100;\nexports.y = 200;\n";
  if (isTyped) {
    files["lib.d.cts"] = "export declare const x: number;\n";
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
  const barrelEnding = ending === "cjs" ? "mjs" : ending;
  const to = (name: string) => JSON.stringify(isTyped ? `./${name}` : `./${name}.${barrelEnding}`);
  if (side === "export *") files[`barrel.${barrelEnding}`] = `export * from "./lib.cjs";\n`;
  if (side === "export { x } from") files[`barrel.${barrelEnding}`] = `export { x } from "./lib.cjs";\n`;
  if (side === "export * of export *" || side === "export { x } from a star") {
    files[`barrel.${barrelEnding}`] =
      `export ${side === "export * of export *" ? "*" : "{ x }"} from ${to("second-barrel")};\n`;
    files[`second-barrel.${barrelEnding}`] = `export * from "./lib.cjs";\n`;
  }
  const from = side === "none" ? `"./lib.cjs"` : to("barrel");

  const head: string[] = [];
  const names: string[] = [];
  let holder: string | undefined;
  if (reach.startsWith("by name")) {
    head.push(`import { x } from ${from};`);
    names.push("x");
  }
  if (reach.endsWith("the namespace")) {
    head.push(`import * as everything from ${from};`);
    names.push("everything.x");
    holder = "everything";
  }
  if (reach === "the default") {
    head.push(`import whole from ${from};`);
    names.push("whole.x");
    holder = "whole";
  }
  if (reach === "require") {
    head.push(`const required = require(${from});`);
    names.push("required.x");
    holder = "required";
  }
  if (reach === "import()") {
    head.push(`const later = await import(${from});`);
    names.push("later.x");
    holder = "later";
  }
  if (second === "x of the file below") {
    files[`second.${barrelEnding}`] =
      `${isTyped ? "// @ts-nocheck\n" : ""}import { x } from "${below}";\nconsole.log("second", x);\n`;
    head.push(ending === "cjs" ? `require("./second.mjs");` : `import ${to("second")};`);
  }
  if (second === "the file below is required") {
    files["second.cjs"] = `console.log("second", require("${below}").x);\n`;
    head.push(
      ending === "cjs" ? `require("./second.cjs");` : `${isTyped ? "// @ts-ignore\n" : ""}import "./second.cjs";`,
    );
  }

  const anything = isTyped ? "(globalThis as any)" : "globalThis";
  const lines: string[] = [];
  const say = (label: string) => {
    for (const name of names) {
      const use = random.pick([name, `${name} + 1`, `typeof ${name}`, `${name} === 1`, `[${name}].length + ${name}`]);
      lines.push(
        "try {",
        ...(loops
          ? [
              "  let result;",
              `  for (let turn = 0; turn < 10000; turn++) result = ${use};`,
              `  console.log("${label}", result);`,
            ]
          : [`  console.log("${label}", ${use});`]),
        "} catch (error) {",
        `  console.log("${label}", "THROWS", error instanceof TypeError ? "TypeError" : error instanceof ReferenceError ? "ReferenceError" : typeof error);`,
        "}",
      );
    }
  };
  say("at first");
  if (holder) lines.push(`console.log("keys", Object.keys(${holder}).join(), Reflect.has(${holder}, "x"));`);
  lines.push(`${anything}.change?.();`);
  say("changed");
  if (corner === "the variable is assigned later") {
    lines.push(`${anything}.swap();`);
    say("swapped");
  }
  if (corner === "the getter counts" && !loops) lines.push(`console.log("reads", ${anything}.reads);`);
  if (!isTyped && (reach === "the default" || reach === "require")) {
    lines.push(
      "try {",
      `  ${holder}.x = 7;`,
      "} catch (error) {",
      `  console.log("the store throws", error.constructor.name);`,
      "}",
    );
    say("stored");
  }
  const isModule = head.some(line => /^(?:\/\/ @ts-ignore\n)?import /.test(line));
  return {
    file: `main.${ending}`,
    text: [...head, ...lines, ...(isModule || ending === "cjs" ? [] : ["export {};"])].join("\n") + "\n",
    files,
  };
}
