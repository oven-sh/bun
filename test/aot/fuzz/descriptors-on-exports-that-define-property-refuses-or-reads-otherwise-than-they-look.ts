// Small programs of two or three files. A CommonJS file defines names on its exports with descriptors that look nearly like the ones compilers emit, and another file requires or imports the
// names. Many of the descriptors are ones that the language refuses (a getter beside `writable` or `value`, a getter that is no function, a second definition of a name that cannot be
// defined again, an object that takes no more names); others hold their fields where a glance does not find them (inherited, spread, computed, behind a getter, written twice).
//
//   the fields     get, set, value, writable, enumerable, configurable, in any number and order
//   a getter       a function, an arrow, a method, `undefined`, `null`, a number, a text, an object, a name that holds one of these
//   the fields lie in the literal, in its `__proto__`, in a spread, under a computed key, behind a getter, twice, in an object made elsewhere
//   defined by     `Object.defineProperty`, `Object.defineProperties`, `Reflect.defineProperty`, `Object.create` stored to `module.exports`
//   on             `exports`, `module.exports`, `this`, a constant that holds one of them; as they are, frozen, sealed, closed to new names, or with the name defined before
//   a refusal      is caught in the file and written down, or leaves the file
//   read by        `require`, an import of the name, of the namespace, of the default, `import()`
import type { Random } from "./random";

export function generate(random: Random): { file: string; text: string; files: Record<string, string> } {
  const reader = random.weighted([
    [4, "require"],
    [3, "names"],
    [2, "namespace"],
    [2, "default"],
    [2, "import()"],
    [1, "require in a try"],
  ]);
  // A name that is not enumerable is not among the names that an import finds.
  const isImported = !reader.startsWith("require");
  // Half the programs hold to what compilers emit but for one field.
  const isNear = random.chance(0.5);
  const lib: string[] = [
    `"use strict";`,
    "const x = 41;",
    "const held = function () {\n  return x + 1;\n};",
    "const nothing = undefined;",
    "const number = 7;",
  ];
  if (random.chance(0.5)) lib.push(`Object.defineProperty(exports, "__esModule", { value: true });`);
  const target = isNear
    ? "exports"
    : random.weighted([
        [6, "exports"],
        [2, "module.exports"],
        [1, "this"],
        [1, "same"],
      ]);
  if (target === "same") lib.push("const same = exports;");
  const names = ["a", "b", "c"].slice(0, isNear && random.chance(0.7) ? 1 : random.between(1, 3));
  const catches = random.chance(isNear ? 0.25 : 0.6);
  for (const name of names) {
    const getter = () =>
      random.weighted([
        [6, "function () {\n  return x;\n}"],
        [3, "() => x"],
        [2, "held"],
        [1, "undefined"],
        [1, "null"],
        [1, "7"],
        [1, `"text"`],
        [1, "{}"],
        [1, "nothing"],
        [1, "number"],
        [1, "held.bind()"],
      ]);
    const field = (key: string): string =>
      key === "get"
        ? random.chance(0.15)
          ? "get() {\n  return x;\n}"
          : `get: ${getter()}`
        : key === "set"
          ? `set: ${random.weighted([
              [4, "function (given) {}"],
              [1, "undefined"],
              [1, "null"],
              [1, "1"],
            ])}`
          : key === "value"
            ? `value: ${random.pick(["x", "1", "undefined", "held", `"v"`])}`
            : key === "enumerable" && (isImported || isNear)
              ? "enumerable: true"
              : `${key}: ${random.weighted([
                  [isNear ? 6 : 4, "true"],
                  [isNear ? 10 : 3, "false"],
                  [1, "undefined"],
                  [1, "0"],
                  [1, `"yes"`],
                ])}`;
    const drawnShape = random.weighted([
      [4, ["enumerable", "get"]],
      [4, ["enumerable", "get", "writable"]],
      [2, ["get", "value"]],
      [2, ["enumerable", "get", "configurable"]],
      [2, ["set", "writable"]],
      [2, ["set", "value"]],
      [2, ["get", "set"]],
      [2, ["enumerable", "value"]],
      [2, ["value", "writable", "enumerable", "configurable"]],
      [1, ["get", "set", "value", "writable"]],
      [1, ["enumerable"]],
      [1, []],
    ]);
    const nearShape = [
      "enumerable",
      "get",
      random.pick(["writable", "writable", "writable", "writable", "value", "set", "configurable"]),
    ];
    const wide = isImported && !drawnShape.includes("enumerable") ? ["enumerable", ...drawnShape] : drawnShape;
    const shape = isNear ? nearShape : wide;
    const keys = random.chance(0.3) ? [...shape].reverse() : shape;
    const odd = keys.length ? random.below(keys.length) : 0;
    const where =
      isNear && random.chance(0.8)
        ? "literal"
        : random.weighted([
            [8, "literal"],
            [1, "inherited"],
            [1, "spread"],
            [1, "computed"],
            [1, "behind a getter"],
            [1, "twice"],
            [1, "elsewhere"],
            [1, "no object"],
          ] as const);
    const fields = keys.map(field);
    let descriptor = `{ ${fields.join(", ")} }`;
    if (where === "inherited" && keys.length)
      descriptor = `{ __proto__: { ${fields[odd]} }, ${fields.filter((_, at) => at !== odd).join(", ")} }`;
    else if (where === "spread" && keys.length)
      descriptor = `{ ...{ ${fields[odd]} }, ${fields.filter((_, at) => at !== odd).join(", ")} }`;
    else if (where === "computed" && keys.length && !fields[odd].startsWith("get()"))
      descriptor = `{ ${fields.map((text, at) => (at === odd ? text.replace(/^(\w+):/, `["$1"]:`) : text)).join(", ")} }`;
    else if (where === "behind a getter" && keys.length && !fields[odd].startsWith("get()"))
      descriptor = `{ ${fields.map((text, at) => (at === odd ? text.replace(/^(\w+): ([^]*)$/, "get $1() {\n  return $2;\n}") : text)).join(", ")} }`;
    else if (where === "twice" && keys.length) descriptor = `{ ${[...fields, field(keys[odd])].join(", ")} }`;
    else if (where === "elsewhere") {
      lib.push(`const described_${name} = ${descriptor};`);
      descriptor = `described_${name}`;
    } else if (where === "no object")
      descriptor = random.pick(["undefined", "null", "1", `"get"`, isImported ? "true" : "held"]);
    const before = isNear
      ? ""
      : random.weighted([
          [8, ""],
          [1, `Object.defineProperty(${target}, "${name}", { value: 0, enumerable: true });`],
          [1, `Object.defineProperty(${target}, "${name}", { value: 0, enumerable: true, configurable: true });`],
          [1, `${target}.${name} = 0;`],
          [1, `Object.preventExtensions(${target});`],
          [1, `Object.freeze(${target});`],
          [1, `Object.seal(${target});`],
        ]);
    if (before) lib.push(before);
    const defines = isNear
      ? `Object.defineProperty(${target}, "${name}", ${descriptor});`
      : random.weighted([
          [8, `Object.defineProperty(${target}, "${name}", ${descriptor});`],
          [2, `Object.defineProperties(${target}, { ${name}: ${descriptor} });`],
          [2, `console.log("lib ${name} answers", Reflect.defineProperty(${target}, "${name}", ${descriptor}));`],
          [
            1,
            `module.exports = Object.create(${random.pick(["null", "Object.prototype", "exports"])}, { ${name}: ${descriptor} });`,
          ],
        ]);
    lib.push(
      catches
        ? `try {\n${defines}\n} catch (error) {\nconsole.log("lib ${name} throws", error.constructor.name);\n}`
        : defines,
    );
  }
  lib.push(`console.log("lib ends");`);
  const files: Record<string, string> = { "lib.cjs": lib.join("\n") + "\n" };
  // Most readers only read the names; the others also ask for the descriptors and the keys, which takes the whole object.
  const isWhole = random.chance(0.3);
  const show = (holder: string) =>
    names
      .map(name =>
        isWhole
          ? `try {\nconsole.log("${name}", typeof ${holder}.${name}, said(${holder}.${name}), (found => found && [typeof found.value, typeof found.get, typeof found.set, found.writable, found.enumerable, found.configurable].join())(Object.getOwnPropertyDescriptor(${holder}, "${name}")));\n} catch (error) {\nconsole.log("${name} throws", error.constructor.name);\n}`
          : `console.log("${name}", typeof ${holder}.${name}, said(${holder}.${name}));`,
      )
      .join("\n") + (isWhole ? `\nconsole.log(Object.keys(${holder}).join());` : "");
  const said = `const said = value => (typeof value === "function" ? "a function" : String(value));\n`;
  if (reader === "require")
    return {
      file: "main.cjs",
      text: `${said}const lib = require("./lib.cjs");\n${show("lib")}\n`,
      files,
    };
  if (reader === "require in a try")
    return {
      file: "main.cjs",
      text: `${said}let lib = {};\ntry {\nlib = require("./lib.cjs");\n} catch (error) {\nconsole.log("require throws", error.constructor.name);\n}\n${show("lib")}\n`,
      files,
    };
  if (reader === "names")
    return {
      file: "main.mjs",
      text: `import { ${names.join(", ")} } from "./lib.cjs";\n${said}${names.map(name => `console.log("${name}", typeof ${name}, said(${name}));`).join("\n")}\n`,
      files,
    };
  if (reader === "namespace")
    return {
      file: "main.mjs",
      text: `import * as lib from "./lib.cjs";\n${said}${show("lib")}\n`,
      files,
    };
  if (reader === "default")
    return {
      file: "main.mjs",
      text: `import lib from "./lib.cjs";\n${said}${show("lib")}\n`,
      files,
    };
  return {
    file: "main.mjs",
    text: `${said}let lib = {};\ntry {\nlib = await import("./lib.cjs");\n} catch (error) {\nconsole.log("import throws", error.constructor.name);\n}\n${show("lib")}\n`,
    files,
  };
}
