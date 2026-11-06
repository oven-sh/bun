// An ES module or a TypeScript module takes names from a CommonJS file, directly or through a module that hands them on. The file stores the
// names in many ways: on `exports`, on what it puts in place of `module.exports`, under a key that it computes, late, never, or behind a getter.
// What is compared is which files run, in which order, what each name holds, and how the program ends where a name is missing.
import type { Random } from "./random";

const stores = [
  `exports.one = 1;\nexports.two = 2;`,
  `module.exports = { one: 1, two: 2 };`,
  `module.exports = function made() {};\nexports.one = 1;`,
  `module.exports = function made() {};\nmodule.exports.one = 1;`,
  `module.exports = class Made {\n  static one = 1;\n};`,
  `module.exports = "text";\nexports.one = 1;`,
  `module.exports = { two: 2 };\nexports.one = 1;`,
  `module.exports = 7;`,
  `module.exports = null;`,
  `module.exports = undefined;`,
  `module.exports = [1, 2];`,
  `module.exports = Object.create({ one: 1 });\nmodule.exports.two = 2;`,
  `module.exports = new Proxy({ one: 1 }, {});`,
  `module.exports = new Proxy({}, { get: (target, key) => (typeof key === "string" ? "got " + key : undefined) });`,
  `Object.defineProperty(exports, "one", { get: () => (console.log("the getter runs"), 1), enumerable: true });`,
  `Object.defineProperty(exports, "one", { value: 1 });`,
  `Object.assign(exports, { one: 1, two: 2 });`,
  `const key = ["o", "ne"].join("");\nexports[key] = 1;`,
  `if (process.argv.length > 99) exports.one = 1;\nexports.two = 2;`,
  `exports.one = 1;\ndelete exports.one;\nexports.two = 2;`,
  `exports.two = 2;\nsetTimeout(() => (exports.one = "late"), 0);`,
  `exports.__esModule = true;\nexports.default = "the default";\nexports.one = 1;`,
  `Object.defineProperty(exports, "__esModule", { value: true });\nexports.one = 1;`,
  `module.exports = require("./other.cjs");`,
  `module.exports = { ...require("./other.cjs"), two: 2 };`,
  `exports = { one: 1 };\nexports.two = 2;`,
  `exports.one = 1;\nObject.freeze(exports);`,
  `exports.one = 1;\nmodule.exports = { two: 2 };`,
  `exports.one = 1;\nmodule.exports = exports;\nexports.two = 2;`,
  `const mine = module.exports;\nmine.one = 1;`,
  `this.one = 1;`,
  `module["exports"] = { one: 1 };`,
  `(function (target) {\n  target.one = 1;\n})(exports);`,
  `exports.one = 1;\nthrow new Error("half-way");`,
  `exports.one = undefined;`,
  `exports.one = 1;\nexports.one = "again";`,
  `module.exports = {\n  get one() {\n    throw new RangeError("from the getter");\n  },\n};`,
  `for (const name of ["one", "two"]) exports[name] = name;`,
  `module.exports = Object.freeze({ one: 1 });`,
  `module.exports = new (class {\n  one = 1;\n  get two() {\n    return 2;\n  }\n})();`,
  `module.exports = new Map([["one", 1]]);`,
  `module.exports = Symbol("exported");`,
  `module.exports = 10n;`,
  `module.exports = () => "called";\nmodule.exports.default = "own default";`,
  `module.exports = { default: "own default", one: 1 };`,
] as const;

const others = [`exports.one = "of the other";`, `module.exports = { two: "of the other" };`, `module.exports = function other() {};`] as const;

// `needs` are the names that the statement asks of the module it names. A module that is no CommonJS file and has no such export is refused by
// the build, so such a program is not written.
interface Take {
  text: string;
  needs: readonly string[];
  reads: readonly string[];
  isTyped?: boolean;
}
const takes: readonly Take[] = [
  { text: `import { one } from FROM;`, needs: [`one`], reads: [`one`] },
  { text: `import { one, two } from FROM;`, needs: [`one`, `two`], reads: [`one`, `two`] },
  { text: `import { absent } from FROM;`, needs: [`absent`], reads: [`absent`] },
  { text: `import { one as first, absent as second } from FROM;`, needs: [`one`, `absent`], reads: [`first`, `second`] },
  { text: `import whole from FROM;`, needs: [`default`], reads: [`typeof whole`, `whole?.one`] },
  { text: `import whole, { one } from FROM;`, needs: [`default`, `one`], reads: [`typeof whole`, `one`] },
  { text: `import { default as whole, two } from FROM;`, needs: [`default`, `two`], reads: [`typeof whole`, `two`] },
  {
    text: `import * as all from FROM;`,
    needs: [],
    reads: [`Object.keys(all).join()`, `all.one`, `all.absent`, `typeof all.default`, `"one" in all`],
  },
  { text: `import { "one" as quoted } from FROM;`, needs: [`one`], reads: [`quoted`] },
  { text: `import FROM;`, needs: [], reads: [] },
  { text: `import { __esModule as mark } from FROM;`, needs: [`__esModule`], reads: [`mark`] },
  { text: `import { type absent, one } from FROM;`, needs: [`one`], reads: [`one`], isTyped: true },
  { text: `import type { absent } from FROM;`, needs: [], reads: [], isTyped: true },
  { text: `import { type one } from FROM;`, needs: [], reads: [], isTyped: true },
];

interface Hand {
  text: string;
  needs: readonly string[];
  gives: readonly string[];
  givesAll?: boolean;
  isTyped?: boolean;
}
const hands: readonly Hand[] = [
  { text: `export { one } from FROM;`, needs: [`one`], gives: [`one`] },
  { text: `export { one, two } from FROM;`, needs: [`one`, `two`], gives: [`one`, `two`] },
  { text: `export { absent } from FROM;`, needs: [`absent`], gives: [`absent`] },
  { text: `export { absent as one } from FROM;`, needs: [`absent`], gives: [`one`] },
  { text: `export { one as absent } from FROM;`, needs: [`one`], gives: [`absent`] },
  { text: `export { default } from FROM;`, needs: [`default`], gives: [`default`] },
  { text: `export { default as one } from FROM;`, needs: [`default`], gives: [`one`] },
  { text: `export * from FROM;`, needs: [], gives: [], givesAll: true },
  { text: `export * as one from FROM;`, needs: [], gives: [`one`] },
  { text: `import { one } from FROM;\nexport { one };`, needs: [`one`], gives: [`one`] },
  { text: `import { absent } from FROM;\nexport { absent as one };`, needs: [`absent`], gives: [`one`] },
  { text: `import * as all from FROM;\nexport const one = all.one;`, needs: [], gives: [`one`] },
  { text: `import whole from FROM;\nexport const { one, two } = whole ?? {};`, needs: [`default`], gives: [`one`, `two`] },
  { text: `export { one } from FROM;\nexport * from FROM;`, needs: [`one`], gives: [`one`], givesAll: true },
  { text: `export * from FROM;\nexport const one = "of the module";`, needs: [], gives: [`one`], givesAll: true },
  { text: `export type { one } from FROM;`, needs: [], gives: [], isTyped: true },
  { text: `export { type one, two } from FROM;`, needs: [`two`], gives: [`two`], isTyped: true },
  { text: `export { type absent, one } from FROM;`, needs: [`one`], gives: [`one`], isTyped: true },
  { text: `import { type absent, one } from FROM;\nexport { one };`, needs: [`one`], gives: [`one`], isTyped: true },
  { text: `import type { absent } from FROM;\nexport const one = 1;`, needs: [], gives: [`one`], isTyped: true },
  { text: `import { absent } from FROM;\nexport const one = 1;`, needs: [`absent`], gives: [`one`], isTyped: true },
  {
    text: `import { absent } from FROM;\nexport type Kept = typeof absent;\nexport const one = 1;`,
    needs: [`absent`],
    gives: [`one`],
    isTyped: true,
  },
];

function pick<T>(random: Random, list: readonly T[]): T {
  return list[random.below(list.length)];
}

export function generate(random: Random): { file: string; text: string; files: Record<string, string> } {
  const files: Record<string, string> = {};
  const store = pick(random, stores);
  // A .js file is read as CommonJS by what it holds.
  const fileName = /^(module\.)?exports\b/.test(store) && random.chance(0.25) ? `file.js` : `file.cjs`;
  files[fileName] = [
    `process.on("exit", code => console.log("the end", code));`,
    `console.log("the file runs");`,
    store,
    `console.log("the file has run");`,
    ``,
  ].join("\n");
  files[`other.cjs`] = [`console.log("the other file runs");`, pick(random, others), ``].join("\n");

  let from = `./${fileName}`;
  // What the module named by `from` is known to export; a CommonJS file, and a module that hands on all of one, may export anything.
  let known = new Set<string>([`default`]);
  let mayHaveMore = true;
  const has = (needs: readonly string[]) => needs.every(name => known.has(name) || (mayHaveMore && name !== `default`));
  const steps = pick(random, [0, 0, 1, 1, 2]);
  for (let step = 0; step < steps; step++) {
    const isTyped = random.chance(0.6);
    const hand = pick(
      random,
      hands.filter(hand => (isTyped || !hand.isTyped) && has(hand.needs)),
    );
    const name = `step${step}.${isTyped ? `ts` : `mjs`}`;
    files[name] = [
      ...(isTyped ? [`// @ts-nocheck`] : []),
      hand.text.replaceAll(`FROM`, JSON.stringify(from)),
      `console.log("module ${step} runs");`,
      ``,
    ].join("\n");
    from = `./${name}`;
    known = new Set([...hand.gives, ...(hand.givesAll ? [...known].filter(name => name !== `default`) : [])]);
    mayHaveMore = mayHaveMore && hand.givesAll === true;
  }

  const isTyped = random.chance(0.5);
  const take = pick(
    random,
    takes.filter(take => (isTyped || !take.isTyped) && has(take.needs)),
  );
  const areRead = random.chance(0.8);
  const reader = [
    ...(isTyped ? [`// @ts-nocheck`] : []),
    take.text.replaceAll(`FROM`, JSON.stringify(from)),
    `console.log("the reader runs");`,
    `function show(label, read) {\n  try {\n    console.log(label, String(read()));\n  } catch (error) {\n    console.log(label, "threw", error.name);\n  }\n}`,
    ...(areRead ? take.reads.map(read => `show(${JSON.stringify(read)}, () => ${read});`) : []),
    ...(areRead && random.chance(0.4)
      ? [`setTimeout(() => {\n${take.reads.map(read => `  show(${JSON.stringify(`later ` + read)}, () => ${read});`).join("\n")}\n}, 5);`]
      : []),
    ``,
  ].join("\n");

  const way = random.below(4);
  const extension = isTyped ? `ts` : `mjs`;
  if (way < 2) return { file: `main.${extension}`, text: reader, files };
  files[`reader.${extension}`] = reader;
  const text =
    way === 2
      ? [
          `console.log("the entry point runs");`,
          `try {\n  await import("./reader.${extension}");\n} catch (error) {\n  console.log("the import failed", error.name);\n}`,
          `console.log("the entry point is through");`,
          ``,
        ].join("\n")
      : [
          `console.log("the entry point runs");`,
          `try {\n  const got = require("./reader.${extension}");\n  console.log("required", Object.keys(got).join());\n} catch (error) {\n  console.log("the require failed", error.name);\n}`,
          ``,
        ].join("\n");
  return { file: way === 2 ? `main.mjs` : `main.cjs`, text, files };
}
