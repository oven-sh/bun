// Small programs in which one file exports a thing, another file copies its own properties by their descriptors onto another object, and the program reads the copy (`corners`: the thing and the way to copy).
//
//   the thing  (`sources`) functions of every kind, with and without members of their own, functions and constructors of the language, of built-in modules and of Bun; classes with static members of every kind; lists of
//              every make, views, arguments, boxed texts; literals, instances, errors, regular expressions, what a regular expression finds, templates, prototypes, namespaces of the language and of modules, proxies
//   the way    (`ways`) `Object.defineProperties` with `Object.getOwnPropertyDescriptors`, `Object.create` with them, a loop over the keys, onto a literal that has such members, a function, a list or an instance, with
//              every descriptor changed, the values alone, one name at a time, a copy of the copy
//   the reads  by a dot, in brackets, by a pattern; straight, into a fresh literal, a list, a field of a class, a parameter; then every key with its descriptor
//   the files  one to three; ES modules or CommonJS; JavaScript, or TypeScript in which the function that copies says that it answers what it was handed
//
// TypeScript accepts every program. The executable prints what plain Bun prints and ends as it ends.
import type { Random } from "./random";

/** Statements that define `source`, the names that are read by name, and `t` where TypeScript knows those names on it. `q`: its keys are not listed, there are too many or they differ from version to version. */
type Source = readonly [text: string, names: string, more?: string];

const fn = "name length prototype";
export const sources: Record<string, Source> = {
  "a function": ["function source(a, b) {\n  return a + b;\n}", fn, "t"],
  "an arrow": ["const source = (a, b) => a + b;", "name length", "t"],
  "an asynchronous function": ["async function source(a) {\n  return a;\n}", "name length", "t"],
  "a generator function": ["function* source(a) {\n  yield a;\n}", fn, "t"],
  "an asynchronous generator function": ["async function* source(a) {\n  yield a;\n}", fn, "t"],
  "a method": ["const { source } = {\n  source(a) {\n    return a;\n  },\n};", "name length", "t"],
  "the function of a getter": [
    'const source = Object.getOwnPropertyDescriptor(\n  {\n    get member() {\n      return 1;\n    },\n  },\n  "member",\n).get;',
    "name length",
  ],
  "a bound function": ["const source = function bound(a, b) {\n  return a + b;\n}.bind(null, 1);", "name length", "t"],
  "a function with members of its own": [
    "const source = Object.assign(function source() {}, { extra: 1, more: { deep: 2 } });",
    "name length extra more",
    "t",
  ],
  "a function under another name": [
    'function source() {}\nObject.defineProperty(source, "name", { value: "renamed" });\nObject.defineProperty(source, "length", { value: 7 });',
    fn,
    "t",
  ],
  "a function whose name is a number": [
    'function source() {}\nObject.defineProperty(source, "name", { value: 5 });',
    "name length",
  ],
  "a function whose prototype was replaced": ["function source() {}\nsource.prototype = { replaced: true };", fn, "t"],
  "a function that has run": ["function source(a) {\n  return a;\n}\nsource(1);\nnew source(2);", fn],
  "a function that lost its name": ["function source() {}\ndelete source.name;\ndelete source.length;", "name length"],
  "a function without a name": ["const source = (() => function () {})();", fn, "t"],
  "a function of the language": ["const source = Math.max;", "name length", "t"],
  "a method of the language": ["const source = Array.prototype.map;", "name length", "t"],
  "the constructor of lists": ["const source = Array;", "name length prototype isArray from", "t"],
  "the constructor of maps": ["const source = Map;", "name length prototype groupBy", "t"],
  "the constructor of promises": ["const source = Promise;", "name length prototype resolve", "t"],
  "the constructor of errors": ["const source = Error;", "name length prototype captureStackTrace stackTraceLimit"],
  "the constructor of objects": ["const source = Object;", "name length prototype keys", "t"],
  "the constructor of functions": ["const source = Function;", fn, "t"],
  "the constructor of symbols": ["const source = Symbol;", "name length iterator asyncIterator", "t"],
  "the constructor of bytes": ["const source = Uint8Array;", "name length BYTES_PER_ELEMENT prototype", "t"],
  "the constructor of proxies": ["const source = Proxy;", "name length revocable", "t"],
  "a function of a built-in module": ['const source = process.getBuiltinModule("node:path").join;', "name length"],
  "a class of a built-in module": [
    'const source = process.getBuiltinModule("node:events");',
    "name length prototype defaultMaxListeners once",
    "q",
  ],
  "the constructor of buffers of node": ["const source = Buffer;", "name length prototype poolSize from", "q"],
  "a function of Bun": ["const source = Bun.file;", "name length"],
  "a function of the host": ["const source = structuredClone;", "name length", "t"],
  "a function that sets a timer": ["const source = setTimeout;", "name length", "q"],
  "a class": ["class source {}", fn, "t"],
  "a class with a constructor": ["class source {\n  constructor(a, b) {\n    this.a = a + b;\n  }\n}", fn],
  "a class with static members": [
    'class source {\n  static made = 1;\n  static half = 0.5;\n  static label = "s";\n  static make() {\n    return new source();\n  }\n}',
    "name length prototype made half label make",
    "t",
  ],
  "a class with static accessors": [
    "class source {\n  static #hidden = 3;\n  static get shown() {\n    return source.#hidden;\n  }\n  static set shown(value) {\n    source.#hidden = value;\n  }\n  static get own() {\n    return this === source;\n  }\n}",
    "name shown own",
    "t",
  ],
  "a class with static members named name and length": [
    'class source {\n  static name = "mine";\n  static length = 9;\n}',
    "name length",
    "t",
  ],
  "a class with a static method named name": [
    "class source {\n  static name() {\n    return 1;\n  }\n}",
    "name length",
  ],
  "a class below a class": [
    "class Base {\n  static below = 1;\n}\nclass source extends Base {\n  static above = 2;\n}",
    "name length above below prototype",
    "t",
  ],
  "a class below a class of the language": [
    "class source extends Map {\n  static extra = 1;\n}",
    "name length extra groupBy",
    "t",
  ],
  "a class without a name": ["const source = (() => class {})();", fn, "t"],
  "a class with a static block": [
    "class source {\n  static first;\n  static {\n    source.first = [1];\n    source.late = 2;\n  }\n}",
    "name first late",
  ],
  "a list of integers": ["const source = [1, 2, 3];", "length 0 2", "t"],
  "a list of fractions": ["const source = [0.5, 1.5];", "length 0 1", "t"],
  "a list of everything": ['const source = [1, "two", null, { three: 3 }, [4]];', "length 0 1 3", "t"],
  "a list with holes": ["const source = [1, , 3];", "length 0 1 2", "t"],
  "an empty list": ["const source = [];", "length 0"],
  "a frozen list": ["const source = Object.freeze([1, 2]);", "length 0", "t"],
  "a list with a member of its own": [
    'const source = Object.assign([1, 2], { label: "mine" });',
    "length 0 label",
    "t",
  ],
  "a list of a thousand": ["const source = Array.from({ length: 1000 }, (_, at) => at);", "length 0 999", "tq"],
  "a list whose length cannot be written": [
    'const source = Object.defineProperty([1, 2], "length", { writable: false });',
    "length 1",
    "t",
  ],
  "an instance of a class below Array": [
    "class Stack extends Array {}\nconst source = Stack.from([1, 2]);",
    "length 0",
    "t",
  ],
  "bytes": ["const source = new Uint8Array([1, 2, 3]);", "length 0 2 byteLength", "t"],
  "the arguments of a call": ["const source = (function () {\n  return arguments;\n})(1, 2);", "length 0 callee"],
  "the arguments of a call in strict code": [
    'const source = (function () {\n  "use strict";\n  return arguments;\n})(1, 2);',
    "length 0",
  ],
  "a boxed text": ['const source = new String("abc");', "length 0 2", "t"],
  "a literal": ['const source = { a: 1, b: "two", c: 0.5 };', "a b c", "t"],
  "a literal with accessors": [
    "let asked = 0;\nconst source = {\n  get counted() {\n    return ++asked;\n  },\n  set counted(value) {\n    asked = value;\n  },\n  get self() {\n    return this === source;\n  },\n  plain: 1,\n};",
    "counted self plain",
    "t",
  ],
  "a literal with symbols and hidden members": [
    'const source = Object.defineProperty({ a: 1, [Symbol("s")]: 2, [Symbol.toStringTag]: "Tagged" }, "hidden", { value: 4 });',
    "a hidden",
  ],
  "a literal with methods that use super": [
    "const source = {\n  __proto__: {\n    below() {\n      return 1;\n    },\n  },\n  above() {\n    return super.below() + 1;\n  },\n};",
    "above below",
  ],
  "an instance of a class": [
    "class Point {\n  #secret = 3;\n  x = 1;\n  y = 0.5;\n  secret() {\n    return this.#secret;\n  }\n}\nconst source = new Point();",
    "x y secret",
    "t",
  ],
  "a frozen literal": ["const source = Object.freeze({ a: 1, b: 2 });", "a b", "t"],
  "an object without a prototype": ["const source = Object.assign(Object.create(null), { a: 1 });", "a"],
  "an object with two hundred keys": [
    'const source = Object.fromEntries(Array.from({ length: 200 }, (_, at) => ["k" + at, at]));',
    "k0 k199",
    "tq",
  ],
  "an error": ['const source = new Error("went wrong", { cause: 1 });', "message cause", "tq"],
  "a regular expression": ['const source = /a/g;\nsource.test("ba");', "lastIndex source", "t"],
  "what a regular expression finds": [
    'const source = /(?<first>a)(b)?/d.exec("xab");',
    "length 0 index input groups indices",
  ],
  "the texts of a template": ["const source = (texts => texts)`a${1}b`;", "length 0 raw", "t"],
  "the prototype of lists": ["const source = Array.prototype;", "length map constructor", "tq"],
  "the prototype of functions": ["const source = Function.prototype;", "name length call", "tq"],
  "the prototype of objects": ["const source = Object.prototype;", "toString constructor __proto__", "q"],
  "the prototype of a class": [
    "class Point {\n  norm() {\n    return 1;\n  }\n  get sum() {\n    return 2;\n  }\n}\nconst source = Point.prototype;",
    "norm sum constructor",
    "t",
  ],
  "the prototype of a function": ["function Maker() {}\nconst source = Maker.prototype;", "constructor"],
  "Math": ["const source = Math;", "PI max", "tq"],
  "JSON": ["const source = JSON;", "parse stringify", "t"],
  "Reflect": ["const source = Reflect;", "get ownKeys", "t"],
  "console": ["const source = console;", "log error", "q"],
  "a built-in module": ['const source = process.getBuiltinModule("node:path");', "sep join posix", "q"],
  "Bun": ["const source = Bun;", "version file", "q"],
  "a proxy whose traps hand on": [
    "const source = new Proxy(\n  { a: 1, b: 2 },\n  {\n    ownKeys: target => Reflect.ownKeys(target),\n    getOwnPropertyDescriptor: (target, key) => Reflect.getOwnPropertyDescriptor(target, key),\n  },\n);",
    "a b",
    "t",
  ],
  "a proxy of a function": ["const source = new Proxy(function inner(a) {}, {});", fn],
  "a date with a member": ["const source = Object.assign(new Date(0), { label: 1 });", "label"],
  "a map with a member": ["const source = Object.assign(new Map([[1, 2]]), { label: 1 });", "label size"],
  "the descriptors of a function": [
    "const source = Object.getOwnPropertyDescriptors(function inner(a) {});",
    "name length",
  ],
};

/** `§` is what is copied; the statements end by returning the copy. `¤` stands for the names that are read by name. */
export const ways: Record<string, string> = {
  "Object.defineProperties onto a literal": "return Object.defineProperties({}, Object.getOwnPropertyDescriptors(§));",
  "Object.create with its prototype":
    "return Object.create(Object.getPrototypeOf(§), Object.getOwnPropertyDescriptors(§));",
  "Object.create without a prototype": "return Object.create(null, Object.getOwnPropertyDescriptors(§));",
  "a loop over the keys":
    "const copy = {};\nfor (const key of Reflect.ownKeys(§)) Object.defineProperty(copy, key, Object.getOwnPropertyDescriptor(§, key));\nreturn copy;",
  "a loop over the keys with Reflect":
    "const copy = {};\nfor (const key of Reflect.ownKeys(§)) Reflect.defineProperty(copy, key, Reflect.getOwnPropertyDescriptor(§, key));\nreturn copy;",
  "onto a literal that has such members":
    'return Object.defineProperties({ name: "before", length: -1, 0: "zero", a: "a", prototype: null }, Object.getOwnPropertyDescriptors(§));',
  "onto a function": "return Object.defineProperties(function target() {}, Object.getOwnPropertyDescriptors(§));",
  "onto an arrow": "return Object.defineProperties(() => {}, Object.getOwnPropertyDescriptors(§));",
  "onto a list": "return Object.defineProperties([], Object.getOwnPropertyDescriptors(§));",
  "onto an instance":
    "class Target {\n  first = 1;\n  name = 2;\n}\nreturn Object.defineProperties(new Target(), Object.getOwnPropertyDescriptors(§));",
  "with every descriptor made to be listed":
    "return Object.defineProperties(\n  {},\n  Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(§)).map(([key, each]) => [key, { ...each, enumerable: true }])),\n);",
  "the values alone": "return Object.fromEntries(Reflect.ownKeys(§).map(key => [key, §[key]]));",
  "one name at a time":
    "const copy = {};\nfor (const name of ¤) {\n  const found = Object.getOwnPropertyDescriptor(§, name);\n  if (found) Object.defineProperty(copy, name, found);\n}\nreturn copy;",
  "a copy of the copy":
    "return Object.defineProperties({}, Object.getOwnPropertyDescriptors(Object.defineProperties({}, Object.getOwnPropertyDescriptors(§))));",
};

export const corners: string[] = Object.keys(sources).flatMap(source =>
  Object.keys(ways).map(way => `${source} | ${way}`),
);

const indented = (lines: string, by = "  ") =>
  lines
    .split("\n")
    .map(line => (line ? by + line : line))
    .join("\n");

export function generate(random: Random, corner: string) {
  const [named, way] = corner.split(" | ");
  const [defines, namesText, more = ""] = sources[named];
  const names = namesText.split(" ");
  const language = random.weighted([
    [4, "JavaScript"],
    [2, "TypeScript, nothing is said"],
    [more.includes("t") ? 3 : 0, "TypeScript, the copy is said to be what was copied"],
  ] as const);
  const isTyped = language !== "JavaScript";
  const isSaid = language === "TypeScript, the copy is said to be what was copied";
  const isCommonJS = !isTyped && random.chance(0.35);
  const script = isCommonJS ? "cjs" : "mjs";
  const typed = isTyped ? "ts" : script;
  const T = (written: string) => (isTyped ? written : "");
  const split = random.weighted([
    [2, "one file"],
    [3, "the thing apart"],
    [4, "every part apart"],
  ] as const);
  const exported = isCommonJS ? "" : "export ";
  const take = (list: string[], from: string, isScript: boolean) =>
    isCommonJS && isScript
      ? `const { ${list.join(", ")} } = require("${from}");\n`
      : `import { ${list.join(", ")} } from "${from}";\n`;

  const any = T(": any");
  const key = (name: string) => (/^\d+$/.test(name) ? `[${name}]` : `.${name}`);
  const copies = `${exported}function copy${isSaid ? "<T extends object>" : ""}(from${isSaid ? ": T" : any})${isSaid ? ": T" : any} {
${indented(
  ways[way]
    .replaceAll("§", isSaid ? "(from as any)" : "from")
    .replaceAll("¤", JSON.stringify(names))
    .replace("const copy = {};", `const copy${any} = {};`)
    .replace(/(etOwnPropertyDescriptor\([^;]*, key\))\);/, `$1${T("!")});`)
    .replace("([key, each])", `([key, each]${T(": [string, any]")})`)
    .replaceAll(/^return (.*);$/gms, isSaid ? "return ($1) as any;" : "return $1;"),
)}
}
`;
  const shows = `${exported}function show(value${any}, depth = 0)${T(": string")} {
  if (typeof value === "string") return value.length > 60 ? "a text of " + value.length : JSON.stringify(value);
  if (typeof value === "symbol") return "@" + value.description;
  if (typeof value === "function") return "function " + String(value.name);
  if (typeof value === "bigint") return value + "n";
  if (typeof value !== "object" || value === null) return Object.is(value, -0) ? "-0" : String(value);
  const name = Object.getPrototypeOf(value)?.constructor?.name ?? "no prototype";
  if (depth > 0) return "object " + String(name);
  return "object " + String(name) + " {" + Object.keys(value).slice(0, 8).map(each => each + ": " + show(value[each], depth + 1)).join(", ") + "}";
}
`;
  const caught = `(error${T(" as Error")}).name`;
  const reads = names
    .map(name => {
      const read = random.weighted([
        [4, `made${key(name)}`],
        [2, `made[${JSON.stringify(/^\d+$/.test(name) ? Number(name) : name)}]`],
        [/^\d+$/.test(name) ? 0 : 2, `(({ ${name}: found }) => found)(made)`],
      ]);
      const kept = random.weighted([
        [3, `show(${read})`],
        [4, `show({ ${/^\d+$/.test(name) ? "first" : name}: ${read} }${key(/^\d+$/.test(name) ? "first" : name)})`],
        [2, `show([${read}][0])`],
        [2, `show(new Kept(${read}).kept)`],
        [2, `show(handed(${read}))`],
        [1, `show(typeof ${read})`],
      ]);
      return `try {\n  console.log(${JSON.stringify(name)}, ${kept});\n} catch (error) {\n  console.log(${JSON.stringify(name)}, "THROWS", ${caught});\n}\n`;
    })
    .join("");
  const listed = more.includes("q")
    ? ""
    : `for (const key of Reflect.ownKeys(made)) {
  const found = Reflect.getOwnPropertyDescriptor(made, key)${T("!")};
  const marks = (found.configurable ? "c" : "-") + (found.enumerable ? "e" : "-") + ("value" in found ? (found.writable ? "w" : "-") : (found.get ? "g" : "-") + (found.set ? "s" : "-"));
  let seen;
  try {
    seen = show(${isSaid ? "(made as any)" : "made"}[key]);
  } catch (error) {
    seen = "THROWS " + ${caught};
  }
  console.log(String(key), marks, seen);
}
try {
  console.log(Object.keys(made).join(), JSON.stringify(Object.keys({ ...made })));
} catch (error) {
  console.log("a spread THROWS", ${caught});
}
`;
  const helpers = `class Kept {\n  kept${any};\n  constructor(kept${any}) {\n    this.kept = kept;\n  }\n}\nfunction handed(value${any}) {\n  return value;\n}\n`;
  const body = `let made${isSaid ? "" : any};\ntry {\n  made = copy(source);\n} catch (error) {\n  console.log("THROWS", ${caught});\n  made = ${isSaid ? "source" : "{}"};\n}\n${reads}${listed}`;
  const files: Record<string, string> = {};
  const from = (file: string, extension: string) => `./${file}${extension === "ts" ? "" : "." + extension}`;
  const strip = (part: string) => part.replaceAll(/^export /gm, "");
  // The thing is written in JavaScript; TypeScript infers what it is, or is told nothing.
  const thing = defines + "\n" + (isCommonJS ? "exports.source = source;\n" : "export { source };\n");
  let text = "";
  if (split !== "one file" || isTyped) {
    files[`thing.${script}`] = thing;
    if (isTyped && !isSaid) files["thing.d.mts"] = "export declare const source: any;\n";
    text += take(["source"], from("thing", script), !isTyped);
  } else text += defines + "\n";
  if (split === "every part apart") {
    files[`copies.${typed}`] = copies + (isCommonJS ? "exports.copy = copy;\n" : "");
    files[`shows.${typed}`] = shows + (isCommonJS ? "exports.show = show;\n" : "");
    text += take(["copy"], from("copies", typed), !isTyped) + take(["show"], from("shows", typed), !isTyped);
  } else text += strip(copies) + strip(shows);
  text += helpers + body + (isCommonJS ? "" : "export {};\n");
  if (isTyped) {
    files["host.d.ts"] =
      "declare const process: { getBuiltinModule(name: string): any };\ndeclare const Bun: any;\ndeclare const Buffer: any;\n";
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
            ...(isSaid && { allowJs: true }),
          },
        },
        null,
        2,
      ) + "\n";
  }
  return { file: `main.${typed}`, text, files };
}
