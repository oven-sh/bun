// Small programs in which one name, `x`, lies in the last file and reaches the first one through a chain of one to four files, each of which hands on what the file below it has.
//
//   taken (`takes`)       out of what `require` gives: by a pattern (plain, `const`, with a default, under another name, beside or in the rest, nested, in a list, under a written, computed or joined key, as an
//                         assignment, as a parameter), as a member of the call (by name, under a key, optional, behind a comma, a condition or `||`), off a name that holds the object, by `for in`,
//                         `Object.keys`, `Object.entries`, a spread, `Object.assign`, `Reflect.get`, its descriptor, in a function that is handed the object, through `module.require`, a second name for
//                         `require`, `createRequire`, `import.meta.require`; and out of `import()`, by a pattern and as a member
//   handed on (`links`)   by getters as they are written by hand and as TypeScript, Babel and swc emit them, `Object.defineProperties`, getters in a literal, TypeScript's and Babel's `export *`, `Object.assign`,
//                         a spread, `module.exports = require(..)`, stores, a pattern and stores; or by an ES module: `export { } from`, `export * from`, an import that is exported, constants made of a namespace
//   package.json          (`sideEffects`) says nothing of side effects, `false`, `true`, an empty list, a list with the last file, with the first file of the chain, with every second file, or a pattern for
//                         the CommonJS files. It is the package.json of the project, or that of a package in node_modules that holds the chain
//   the last file         CommonJS (stores, a literal) or an ES module (`const`, `let`, `var`); the name holds a text, an integer, a fraction, an object or a function; in some programs a function
//                         of the file that nobody takes would give it another value
//   where it is taken     at the top of the file, in a block, in a `try`, in a function
//   the first file        is what runs, or is loaded by what runs: by a `require` under a condition or in a timer, or by `import()`
//   beside it             a second file below one of the files, whose name nobody takes; a function that requires the last file and that nobody calls, or that is called at the end
//
// A file that package.json says has no side effects has none but what it exports; the others tell that they ran, in a list that is printed sorted. The name is printed when it is taken. In half of the programs
// that one read is all that leads to the last file. In a quarter a function takes the name anew. In the last quarter the last file has a function `change` too, which comes the same way, gives the name
// another value and is called in between: one more road through the chain. The executable prints what plain Bun prints.
import type { Random } from "./random";

type Take = { lines: string[]; result: string; holder?: string; needs?: "an ES module" | "createRequire" };

/** How the first file takes `x` out of the file `§`. */
export const takes: Record<string, Take> = {
  "a pattern": { lines: ["var { x } = require(§);"], result: "x" },
  "a pattern of constants": { lines: ["const { x } = require(§);"], result: "x" },
  "a pattern with a default": { lines: ['var { x = "by default" } = require(§);'], result: "x" },
  "a pattern under another name": { lines: ["var { x: taken } = require(§);"], result: "taken" },
  "a pattern of two names": { lines: ["var { change: other, x } = require(§);"], result: "x" },
  "the rest of a pattern": {
    lines: ["var { change: other, ...rest } = require(§);"],
    result: "rest.x",
    holder: "rest",
  },
  "a pattern beside the rest": { lines: ["var { x, ...rest } = require(§);"], result: "x", holder: "rest" },
  "a nested pattern": { lines: ["var { x: { constructor: made } } = require(§);"], result: "made.name" },
  "a pattern in a list": { lines: ["var [{ x }] = [require(§)];"], result: "x" },
  "a pattern under a written key": { lines: ['var { ["x"]: taken } = require(§);'], result: "taken" },
  "a pattern under a computed key": {
    lines: ['var key = "x";', "var { [key]: taken } = require(§);"],
    result: "taken",
  },
  "a pattern under a joined key": { lines: ['var { ["" + "x"]: taken } = require(§);'], result: "taken" },
  "an assignment to a pattern": { lines: ["var x;", "({ x } = require(§));"], result: "x" },
  "a pattern as a parameter": {
    lines: ["var taken = (function ({ x }) {", "  return x;", "})(require(§));"],
    result: "taken",
  },
  "a pattern as the parameter of an arrow": { lines: ["var taken = (({ x }) => x)(require(§));"], result: "taken" },
  "a member of the call": { lines: ["var taken = require(§).x;"], result: "taken" },
  "a member under a written key": { lines: ['var taken = require(§)["x"];'], result: "taken" },
  "a member under a computed key": { lines: ['var key = "x";', "var taken = require(§)[key];"], result: "taken" },
  "an optional member": { lines: ["var taken = require(§)?.x;"], result: "taken" },
  "a member behind a comma": { lines: ["var taken = (0, require(§)).x;"], result: "taken" },
  "a member behind a condition": { lines: ["var taken = (globalThis.process ? require(§) : {}).x;"], result: "taken" },
  "a member behind ||": { lines: ["var taken = (require(§) || {}).x;"], result: "taken" },
  "a name that holds the object": { lines: ["var holder = require(§);"], result: "holder.x", holder: "holder" },
  "a constant that holds the object": { lines: ["const holder = require(§);"], result: "holder.x", holder: "holder" },
  "a pattern over a name that holds the object": {
    lines: ["var holder = require(§);", "var { x } = holder;"],
    result: "x",
    holder: "holder",
  },
  "for in": {
    lines: ["var holder = require(§);", "var taken;", 'for (var key in holder) if (key === "x") taken = holder[key];'],
    result: "taken",
    holder: "holder",
  },
  "Object.keys": {
    lines: [
      "var holder = require(§);",
      'var taken = Object.keys(holder).filter(key => key === "x").map(key => holder[key])[0];',
    ],
    result: "taken",
    holder: "holder",
  },
  "Object.entries": { lines: ["var taken = Object.fromEntries(Object.entries(require(§))).x;"], result: "taken" },
  "a spread": { lines: ["var taken = { ...require(§) }.x;"], result: "taken" },
  "Object.assign": { lines: ["var taken = Object.assign({}, require(§)).x;"], result: "taken" },
  "Reflect.get": { lines: ['var taken = Reflect.get(require(§), "x");'], result: "taken" },
  "its descriptor": {
    lines: [
      'var descriptor = Object.getOwnPropertyDescriptor(require(§), "x");',
      "var taken = descriptor && (descriptor.get ? descriptor.get() : descriptor.value);",
    ],
    result: "taken",
  },
  "a function that is handed the object": {
    lines: ["var read = function (object) {", "  return object.x;", "};", "var taken = read(require(§));"],
    result: "taken",
  },
  "module.require": { lines: ["var { x } = module.require(§);"], result: "x" },
  "a second name for require": { lines: ["var load = require;", "var { x } = load(§);"], result: "x" },
  "createRequire": { lines: ["var { x } = require(§);"], result: "x", needs: "createRequire" },
  "import.meta.require": { lines: ["var { x } = import.meta.require(§);"], result: "x", needs: "an ES module" },
  "a pattern over import()": { lines: ["var { x } = await import(§);"], result: "x", needs: "an ES module" },
  "a member of import()": { lines: ["var taken = (await import(§)).x;"], result: "taken", needs: "an ES module" },
};

const mark = `Object.defineProperty(exports, "__esModule", { value: true });\n`;
const getter = (name: string, holder: string) =>
  `Object.defineProperty(exports, "${name}", { enumerable: true, get: function () { return ${holder}.${name}; } });\n`;
type Source = { holder: string; names: string[]; below: string };
type Link = { ending: "cjs" | "mjs"; text: (sources: Source[]) => string };
const each = (sources: Source[], text: (source: Source) => string) => sources.map(text).join("");
const eachName = (sources: Source[], text: (name: string, source: Source) => string, between = "") =>
  sources.flatMap(source => source.names.map(name => text(name, source))).join(between);
const required = (sources: Source[], prefix = "", suffix = "") =>
  each(sources, ({ holder, below }) => `var ${prefix}${holder}${suffix} = require(${below});\n`);

/** How a file hands on the names of the files below it. */
export const links: Record<string, Link> = {
  "getters by hand": {
    ending: "cjs",
    text: sources => required(sources, "", "_1") + eachName(sources, (name, { holder }) => getter(name, `${holder}_1`)),
  },
  "getters as TypeScript emits them": {
    ending: "cjs",
    text: sources =>
      `"use strict";\n${mark}exports.${sources
        .flatMap(source => source.names)
        .reverse()
        .join(" = exports.")} = void 0;\n` +
      each(
        sources,
        source => required([source], "", "_1") + eachName([source], name => getter(name, `${source.holder}_1`)),
      ),
  },
  "getters as Babel emits them": {
    ending: "cjs",
    text: sources =>
      `"use strict";\n\n${mark}` +
      eachName(sources, (name, { holder }) => getter(name, `_${holder}`)) +
      required(sources, "_"),
  },
  "getters as swc emits them": {
    ending: "cjs",
    text: sources =>
      `"use strict";\n${mark}function _export(target, all) {\n    for(var name in all)Object.defineProperty(target, name, {\n        enumerable: true,\n        get: Object.getOwnPropertyDescriptor(all, name).get\n    });\n}\n_export(exports, {\n` +
      eachName(
        sources,
        (name, { holder }) => `    get ${name} () {\n        return _${holder}.${name};\n    }`,
        ",\n",
      ) +
      `\n});\n` +
      each(sources, ({ holder, below }) => `const _${holder} = require(${below});\n`),
  },
  "Object.defineProperties": {
    ending: "cjs",
    text: sources =>
      required(sources) +
      `Object.defineProperties(exports, {\n` +
      eachName(
        sources,
        (name, { holder }) => `  ${name}: { enumerable: true, get: function () { return ${holder}.${name}; } },\n`,
      ) +
      `});\n`,
  },
  "getters in a literal": {
    ending: "cjs",
    text: sources =>
      required(sources) +
      `module.exports = {\n` +
      eachName(sources, (name, { holder }) => `  get ${name}() {\n    return ${holder}.${name};\n  },\n`) +
      `};\n`,
  },
  "export * as TypeScript emits it": {
    ending: "cjs",
    text: sources =>
      `"use strict";\nvar __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {\n    if (k2 === undefined) k2 = k;\n    var desc = Object.getOwnPropertyDescriptor(m, k);\n    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {\n      desc = { enumerable: true, get: function() { return m[k]; } };\n    }\n    Object.defineProperty(o, k2, desc);\n}) : (function(o, m, k, k2) {\n    if (k2 === undefined) k2 = k;\n    o[k2] = m[k];\n}));\nvar __exportStar = (this && this.__exportStar) || function(m, exports) {\n    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);\n};\n${mark}` +
      each(sources, ({ below }) => `__exportStar(require(${below}), exports);\n`),
  },
  "export * as Babel emits it": {
    ending: "cjs",
    text: sources =>
      `"use strict";\n\n${mark}` +
      each(
        sources,
        ({ holder, below }) =>
          `var _${holder} = require(${below});\nObject.keys(_${holder}).forEach(function (key) {\n  if (key === "default" || key === "__esModule") return;\n  if (key in exports && exports[key] === _${holder}[key]) return;\n  Object.defineProperty(exports, key, {\n    enumerable: true,\n    get: function () {\n      return _${holder}[key];\n    }\n  });\n});\n`,
      ),
  },
  "Object.assign": {
    ending: "cjs",
    text: sources => each(sources, ({ below }) => `Object.assign(exports, require(${below}));\n`),
  },
  "Object.assign to module.exports": {
    ending: "cjs",
    text: sources => each(sources, ({ below }) => `Object.assign(module.exports, require(${below}));\n`),
  },
  "a spread": {
    ending: "cjs",
    text: sources => `module.exports = { ${sources.map(({ below }) => `...require(${below})`).join(", ")} };\n`,
  },
  "the whole": { ending: "cjs", text: sources => `module.exports = require(${sources[0].below});\n` },
  stores: {
    ending: "cjs",
    text: sources =>
      required(sources) + eachName(sources, (name, { holder }) => `exports.${name} = ${holder}.${name};\n`),
  },
  "a pattern and stores": {
    ending: "cjs",
    text: sources =>
      each(sources, ({ names, below }) => `const { ${names.join(", ")} } = require(${below});\n`) +
      eachName(sources, name => `exports.${name} = ${name};\n`),
  },
  "export { } from": {
    ending: "mjs",
    text: sources => each(sources, ({ names, below }) => `export { ${names.join(", ")} } from ${below};\n`),
  },
  "export * from": { ending: "mjs", text: sources => each(sources, ({ below }) => `export * from ${below};\n`) },
  "an import that is exported": {
    ending: "mjs",
    text: sources =>
      each(sources, ({ names, below }) => `import { ${names.join(", ")} } from ${below};\n`) +
      `export { ${sources.flatMap(source => source.names).join(", ")} };\n`,
  },
  "constants made of a namespace": {
    ending: "mjs",
    text: sources =>
      each(sources, ({ holder, below }) => `import * as ${holder} from ${below};\n`) +
      eachName(sources, (name, { holder }) => `export const ${name} = ${holder}.${name};\n`),
  },
};

/** What package.json says of side effects. */
export const sideEffects = [
  "nothing",
  "false",
  "true",
  "an empty list",
  "the last file",
  "the first file of the chain",
  "every second file",
  "a pattern for the CommonJS files",
] as const;

const values = [
  { first: '"five"', next: '"six"' },
  { first: "5", next: "6" },
  { first: "1.5", next: "2.25" },
  { first: "{ a: 1 }", next: "{ a: 2, b: 3 }" },
  { first: "function () {\n  return 1;\n}", next: "function () {\n  return 2;\n}" },
];

/** `next`: what `change` stores. Without it nothing stores the name again. */
const lasts: Record<string, { ending: "cjs" | "mjs"; text: (first: string, next?: string) => string }> = {
  stores: {
    ending: "cjs",
    text: (first, next) =>
      `exports.x = ${first};\n` + (next ? `exports.change = function () {\n  exports.x = ${next};\n};\n` : ""),
  },
  "stores on module.exports": {
    ending: "cjs",
    text: (first, next) =>
      `module.exports.x = ${first};\n` +
      (next ? `module.exports.change = function () {\n  module.exports.x = ${next};\n};\n` : ""),
  },
  "a literal": {
    ending: "cjs",
    text: (first, next) =>
      `module.exports = {\n  x: ${first},\n` +
      (next ? `  change: function () {\n    module.exports.x = ${next};\n  },\n` : "") +
      `};\n`,
  },
  const: {
    ending: "mjs",
    text: (first, next) =>
      next
        ? `export let x = ${first};\nexport function change() {\n  x = ${next};\n}\n`
        : `export const x = ${first};\n`,
  },
  let: {
    ending: "mjs",
    text: (first, next) =>
      `export let x = ${first};\n` + (next ? `export function change() {\n  x = ${next};\n}\n` : ""),
  },
  var: {
    ending: "mjs",
    text: (first, next) =>
      `export var x = ${first};\n` + (next ? `export function change() {\n  x = ${next};\n}\n` : ""),
  },
};

export type Drawn = { take: string; says: (typeof sideEffects)[number]; depth: number; chain?: string[] };

export function generate(
  random: Random,
  { take: way, says, depth, chain }: Drawn,
): { file: string; text: string; files: Record<string, string> } {
  const take = takes[way];
  const drawn = chain ?? Array.from({ length: depth }, () => random.pick(Object.keys(links)));
  const last = lasts[random.pick(Object.keys(lasts))];
  const value = random.pick(values);
  const isPackage = random.chance(0.3);
  const where = random.weighted([
    [5, "at the top"],
    [1, "in a block"],
    [1, "in a try"],
    [2, "in a function"],
  ] as const);
  const entered = random.weighted([
    [5, "it is what runs"],
    [1, "a require under a condition"],
    [1, "a require in a timer"],
    [1, "import()"],
  ] as const);
  // It is one more road to the last file.
  const lazy = chain
    ? "none"
    : random.weighted([
        [5, "none"],
        [1, "nobody calls it"],
        [1, "called at the end"],
      ] as const);
  const unusedBelow = random.chance(0.35) ? random.below(depth) : -1;
  // In half of the programs the one read is all there is.
  const more = chain
    ? "nothing"
    : random.weighted([
        [2, "nothing"],
        [1, "it is taken anew"],
        [1, "it is changed and taken anew"],
      ] as const);
  const isChanged = more === "it is changed and taken anew";
  // Nobody takes the function there: the name may get another value, and never does.
  const hasChange = isChanged || random.chance(0.3);

  // The chain, from the file next to the last one to the file that the program names.
  const names = [`owner.${last.ending}`, ...drawn.map((link, index) => `h${index + 1}.${links[link].ending}`)];
  const hasEffects = (file: string) => {
    const at = names.indexOf(file);
    switch (says) {
      case "nothing":
      case "true":
        return true;
      case "false":
      case "an empty list":
        return false;
      case "the last file":
        return at === 0;
      case "the first file of the chain":
        return at === names.length - 1;
      case "every second file":
        return at >= 0 && at % 2 === 1;
      case "a pattern for the CommonJS files":
        return file.endsWith(".cjs");
    }
  };
  const said = {
    nothing: undefined,
    false: false,
    true: true,
    "an empty list": [],
    "the last file": [`./${names[0]}`],
    "the first file of the chain": [`./${names.at(-1)}`],
    "every second file": names.filter((_, index) => index % 2 === 1).map(name => `./${name}`),
    "a pattern for the CommonJS files": ["*.cjs"],
  }[says];
  const tells = (file: string) =>
    hasEffects(file) ? `(globalThis.ran ??= []).push(${JSON.stringify(file.slice(0, file.indexOf(".")))});\n` : "";
  // A directive stays the first statement.
  const telling = (file: string, text: string) =>
    text.startsWith('"use strict";\n') ? `"use strict";\n${tells(file)}${text.slice(14)}` : tells(file) + text;

  const folder = isPackage ? "node_modules/chain/" : "";
  const files: Record<string, string> = {};
  files[`${folder}package.json`] =
    JSON.stringify({
      name: isPackage ? "chain" : "app",
      version: "1.0.0",
      ...(said !== undefined && { sideEffects: said }),
    }) + "\n";
  files[folder + names[0]] = telling(names[0], last.text(value.first, hasChange ? value.next : undefined));
  drawn.forEach((link, index) => {
    const sources: Source[] = [
      { holder: "dep", names: isChanged ? ["x", "change"] : ["x"], below: JSON.stringify(`./${names[index]}`) },
    ];
    if (index === unusedBelow && link !== "the whole") {
      sources.push({ holder: "unused", names: ["y"], below: `"./unused.cjs"` });
      files[`${folder}unused.cjs`] = tells("unused.cjs") + `exports.y = "nobody takes it";\n`;
    }
    files[folder + names[index + 1]] = telling(names[index + 1], links[link].text(sources));
  });
  const from = (file: string) => JSON.stringify(isPackage ? `chain/${file}` : `./${file}`);

  const isModule = take.needs !== undefined;
  const isAsync = take.lines.some(line => line.includes("await "));
  const taking = take.lines.map(line => line.replaceAll("§", from(names.at(-1)!)));
  const indented = (lines: string[]) => lines.map(line => `  ${line}`);
  const lines: string[] = [];
  if (take.needs === "createRequire")
    lines.push(`import { createRequire } from "node:module";`, `const require = createRequire(import.meta.url);`);
  lines.push(
    "function show(value) {",
    '  return typeof value === "function" ? "function " + value() : typeof value + " " + JSON.stringify(value);',
    "}",
  );
  if (lazy !== "none")
    lines.push(
      "function lazy() {",
      `  return ${isModule && take.needs !== "createRequire" ? "import.meta.require" : "require"}(${from(names[0])});`,
      "}",
    );
  const held = () => [
    `console.log("at first", show(${take.result}));`,
    ...(take.holder ? [`console.log("keys", Object.keys(${take.holder}).sort().join());`] : []),
  ];
  const changing = isChanged
    ? [
        `${isModule && take.needs !== "createRequire" ? "import.meta.require" : "require"}(${from(names.at(-1)!)}).change();`,
        `console.log("as it was taken", show(${take.result}));`,
      ]
    : [];
  switch (where) {
    case "at the top":
      lines.push(...taking, ...held(), ...changing);
      break;
    case "in a block":
      lines.push("{", ...indented([...taking, ...held(), ...changing]), "}");
      break;
    case "in a try":
      lines.push(
        "try {",
        ...indented([...taking, ...held(), ...changing]),
        "} catch (error) {",
        '  console.log("THROWS", error instanceof TypeError ? "TypeError" : typeof error);',
        "}",
      );
      break;
    case "in a function":
      lines.push(
        `${isAsync ? "async " : ""}function first() {`,
        ...indented([...taking, ...held(), ...changing]),
        "}",
        `${isAsync ? "await " : ""}first();`,
      );
      break;
  }
  if (more !== "nothing")
    lines.push(
      `${isAsync ? "async " : ""}function again() {`,
      ...indented(taking),
      `  return ${take.result};`,
      "}",
      `console.log("taken anew", show(${isAsync ? "await " : ""}again()));`,
    );
  if (lazy === "called at the end") lines.push(`console.log("lazy", show(lazy().x));`);
  else if (lazy === "nobody calls it") lines.push("globalThis.lazy = lazy;");
  lines.push(`console.log("ran", (globalThis.ran ?? []).sort().join());`);
  const main = `main.${isModule ? "mjs" : "cjs"}`;
  const text = lines.join("\n") + "\n";
  if (entered === "it is what runs") return { file: main, text, files };
  files[main] = text;
  return {
    file: "start.cjs",
    text: {
      "a require under a condition": `if (process.argv.length < 99) require("./${main}");\n`,
      "a require in a timer": `setTimeout(function () {\n  require("./${main}");\n}, 0);\n`,
      "import()": `import("./${main}");\n`,
      // A file that waits is not required, and `module.require` is asked of a file that was.
    }[isAsync ? "import()" : way === "module.require" && entered === "import()" ? "a require in a timer" : entered],
    files,
  };
}

const ways = Object.keys(takes);
const forms = Object.keys(links);
/** Every way to take the name, under everything that package.json says, at every depth. The files of the chain are drawn. */
const drawnChains = ways.length * sideEffects.length * 4;
/** Every pair of forms, as a chain of three: the first form, the second, the first again. Nothing has side effects, and the name is taken by a pattern. */
const writtenChains = forms.length * forms.length;
/** Every way to take the name, under everything that package.json says, through an ES module between two CommonJS files with getters. */
const chainsOverGetters = ways.length * sideEffects.length;
export const count = drawnChains + writtenChains + chainsOverGetters;

export function drawnAt(index: number): Drawn {
  if (index >= drawnChains + writtenChains) {
    const at = index - drawnChains - writtenChains;
    const getters = forms.filter(form => form.startsWith("getters"));
    const modules = forms.filter(form => links[form].ending === "mjs" && form !== "constants made of a namespace");
    const row = Math.floor(at / ways.length);
    return {
      take: ways[at % ways.length],
      says: sideEffects[row],
      depth: 3,
      // By hand in every second program: the other forms come in turn.
      chain: [
        at % 2 ? getters[at % getters.length] : "getters by hand",
        modules[Math.floor(at / 2) % modules.length],
        at % 4 < 2 ? "getters by hand" : getters[Math.floor(at / 4) % getters.length],
      ],
    };
  }
  if (index >= drawnChains) {
    const [outer, inner] = [forms[Math.floor((index - drawnChains) / forms.length)], forms[index % forms.length]];
    return { take: "a pattern", says: "false", depth: 3, chain: [outer, inner, outer] };
  }
  const row = Math.floor(index / ways.length);
  return {
    take: ways[index % ways.length],
    says: sideEffects[row % sideEffects.length],
    depth: 1 + (Math.floor(row / sideEffects.length) % 4),
  };
}
