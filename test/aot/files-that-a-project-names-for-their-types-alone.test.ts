// A file that is named for its types alone is no module of the program, whatever the tsconfig.json of the file that names it says.
// Each package here ships TypeScript: an index that hands on what the other files export, a file of declarations, and a file that
// takes one of them for the type of a parameter. A program imports many of them and prints what `bun run` prints.
import { expect } from "bun:test";
import { expectSameAnswerAsBunRun, type Files } from "./harness/projects";
import { test } from "./supported";

const namings = [
  "import type",
  "import { type }",
  "import type * as",
  "import()",
  "an import that is erased",
  "through the index",
  "export type from",
  "export * from",
] as const;
const contents = [
  "types alone",
  "a constant",
  "a function",
  "a class",
  "an enum",
  "a constant made of another file's",
  "a constant that holds a function of the index",
  "JavaScript beside its declaration file",
] as const;
const handings = ["by name", "by a star", "as a namespace", "by an import", "not at all"] as const;
const sideEffects = [false, undefined, true, [], ["./src/sums.*"]] as const;
const extensions = ["ts", "mts", "tsx"] as const;
// The last has its sources under the "aot" condition and its compiler options in its package.json.
const places = ["node_modules", "packages", "typed"] as const;

interface Case {
  naming: (typeof namings)[number];
  content: (typeof contents)[number];
  handing: (typeof handings)[number];
  effects: (typeof sideEffects)[number];
  extension: (typeof extensions)[number];
  place: (typeof places)[number];
  /** The program reads what the index hands on. */
  isRead: boolean;
}
type Options = Record<string, unknown>;
type Package = [it: Case, compilerOptions: Options];

const shared = {
  target: "esnext",
  module: "esnext",
  moduleResolution: "bundler",
  noEmit: true,
  allowImportingTsExtensions: true,
  strict: true,
  jsx: "react-jsx",
  types: [],
};

/** What the tsconfig.json of the packages says otherwise than the program's. */
const otherOptions: Options[] = [
  {},
  { lib: ["es2022"] },
  { target: "es2022" },
  { target: "es2020" },
  { module: "nodenext", moduleResolution: "nodenext" },
  { strict: false },
  { strictNullChecks: false },
  { strictFunctionTypes: false },
  { strictBindCallApply: false },
  { strictBuiltinIteratorReturn: false },
  { strictPropertyInitialization: false },
  { noImplicitAny: false },
  { noImplicitThis: false },
  { useUnknownInCatchVariables: false },
  { exactOptionalPropertyTypes: true },
  { noUncheckedIndexedAccess: true },
  { allowJs: true },
  { allowJs: true, maxNodeModuleJsDepth: 2 },
  { resolveJsonModule: false },
  { allowArbitraryExtensions: true },
  { jsx: "preserve" },
  { useDefineForClassFields: false },
  { experimentalDecorators: true },
  { isolatedModules: true },
  { verbatimModuleSyntax: true },
];

function canBeWritten([it, compilerOptions]: Package): boolean {
  const handsOnByName = it.handing === "by name" || it.handing === "by an import";
  if (it.content === "types alone" && (handsOnByName || it.isRead)) return false;
  if (it.isRead && (it.handing === "not at all" || it.place === "typed")) return false;
  if (it.content === "JavaScript beside its declaration file" && it.extension === "mts") return false;
  return !(it.naming === "an import that is erased" && compilerOptions.verbatimModuleSyntax);
}

function* cross(axes: { [Axis in keyof Case]: readonly Case[Axis][] }): Generator<Case> {
  for (const naming of axes.naming)
    for (const content of axes.content)
      for (const handing of axes.handing)
        for (const effects of axes.effects)
          for (const extension of axes.extension)
            for (const place of axes.place)
              for (const isRead of axes.isRead) yield { naming, content, handing, effects, extension, place, isRead };
}

const everyAxis = {
  naming: namings,
  content: contents,
  handing: handings,
  effects: sideEffects,
  extension: extensions,
  place: places,
  isRead: [false, true],
};
const asFirstSeen = {
  naming: ["import type"],
  content: ["a constant"],
  handing: ["by name"],
  effects: [false],
  extension: ["ts"],
  place: ["node_modules"],
  isRead: [false],
} as const;

function writePackage(index: number, [it, compilerOptions]: Package): Files {
  const name = `p${index}`;
  const at = (file: string) => JSON.stringify(`./${file}.${it.extension === "mts" ? "mts" : "js"}`);
  const goods = at("goods");
  const crate = `export interface Crate { weight: number; labels: string[] }\n`;
  const size = `export type Size = "a" | "b";\n`;
  const prices = (first: string) => `export const PRICES: Record<Size, number> = { a: ${first}, b: 2 };\n`;
  const [value, goodsText] = {
    "types alone": ["", crate + size],
    "a constant": ["PRICES", crate + size + prices("1")],
    "a function": [
      "priceOf",
      crate + size + `export function priceOf(size: Size): number { return size === "a" ? 1 : 2; }\n`,
    ],
    "a class": ["Crate", size + `export class Crate { weight = 0; labels: string[] = []; }\n`],
    "an enum": [
      "Size",
      `export enum Size { a, b }\nexport interface Crate { weight: number; labels: string[]; size?: Size }\n`,
    ],
    "a constant made of another file's": [
      "PRICES",
      `import { base } from ${at("base")};\n` + crate + size + prices("base"),
    ],
    "a constant that holds a function of the index": [
      "PRICES",
      `import { isSought } from ${at("index")};\n` + crate + size + `export const PRICES = { a: 1, b: 2, isSought };\n`,
    ],
    "JavaScript beside its declaration file": ["PRICES", ""],
  }[it.content];
  const handsOnByName = it.handing === "by name" || it.handing === "by an import";
  const types = it.handing === "by a star" ? [] : ["Crate", "Size"].filter(type => !(handsOnByName && type === value));
  const handsOn = {
    "by name": `export { ${value} } from ${goods};\n`,
    "by a star": `export * from ${goods};\n`,
    "as a namespace": `export * as goods from ${goods};\n`,
    "by an import": `import { ${value} } from ${goods};\nexport { ${value} };\n`,
    "not at all": "",
  }[it.handing];
  const [names, between] = {
    "import type": [`import type { Crate } from ${goods};\n`],
    "import { type }": [`import { type Crate } from ${goods};\n`],
    "import type * as": [`import type * as goods from ${goods};\ntype Crate = goods.Crate;\n`],
    "import()": [`type Crate = import(${goods}).Crate;\n`],
    "an import that is erased": [`import { Crate } from ${goods};\n`],
    "through the index": [`import type { Crate } from ${at("index")};\n`],
    "export type from": [`import type { Crate } from ${at("between")};\n`, `export type { Crate } from ${goods};\n`],
    "export * from": [`import type { Crate } from ${at("between")};\n`, `export * from ${goods};\n`],
  }[it.naming];
  const sources: Files = {
    index:
      (types.length ? `export type { ${types.join(", ")} } from ${goods};\n` : "") +
      handsOn +
      `export { isSought } from ${at("orders")};\n`,
    ...(goodsText
      ? { goods: goodsText }
      : {
          "goods.js": `export const PRICES = { a: 1, b: 2 };\n`,
          "goods.d.ts": crate + size + `export declare const PRICES: Record<Size, number>;\n`,
        }),
    orders:
      names +
      `import { twice } from ${at("sums")};\n` +
      `const SOUGHT = ${index};\n` +
      `export function isSought(crate: Crate): boolean { return crate.weight === SOUGHT || crate.labels.length === twice(2); }\n`,
    sums: `export function twice(n: number): number { return n * 2; }\n`,
    ...(between && { between }),
    ...(it.content === "a constant made of another file's" && { base: `export const base = 1;\n` }),
  };
  const root = it.place === "packages" ? `packages/${name}` : `node_modules/${name}`;
  const entry = `./src/index.${it.extension}`;
  const options = { ...shared, ...compilerOptions };
  const files: Files = {
    [`${root}/package.json`]: JSON.stringify({
      name,
      version: "1.0.0",
      type: "module",
      sideEffects: it.effects,
      ...(it.place === "typed"
        ? { exports: { ".": { aot: entry, default: "./dist/index.js" } }, compilerOptions: options }
        : { main: entry, types: entry, exports: { ".": entry } }),
    }),
  };
  if (it.place === "typed") {
    files[`${root}/dist/index.js`] =
      `export function isSought(crate) { return crate.weight === ${index} || crate.labels.length === 4; }\n`;
  } else {
    files[`${root}/tsconfig.json`] = JSON.stringify({ compilerOptions: options, include: ["src/**/*"] });
  }
  for (const [file, text] of Object.entries(sources))
    files[`${root}/src/${file.includes(".") ? file : `${file}.${it.extension}`}`] = text;
  const specifier = JSON.stringify(it.place === "packages" ? `./${root}/src/index.${it.extension}` : name);
  const read =
    it.handing === "as a namespace" ? [`goods as read${index}`, `.${value}`] : [`${value} as read${index}`, ""];
  files["main.ts"] =
    `import { isSought as isSought${index}${it.isRead ? `, ${read[0]}` : ""} } from ${specifier};\n` +
    `console.log(${index}, isSought${index}({ weight: ${index}, labels: [] }), isSought${index}({ weight: -1, labels: ["x"] })` +
    `${it.isRead ? `, typeof read${index}${read[1]}` : ""});\n`;
  return files;
}

function writeProgram(packages: Package[]): Files {
  const program: Files = {
    "tsconfig.json": JSON.stringify({ compilerOptions: shared, include: ["main.ts"] }),
    "main.ts": "",
  };
  for (const [index, it] of packages.entries()) {
    const { "main.ts": lines, ...files } = writePackage(index, it);
    Object.assign(program, files);
    program["main.ts"] += lines;
  }
  return program;
}

/** One program of all the packages. If it is red, the packages that are red alone are named. */
async function expectPackagesToWork(packages: Package[]) {
  const written = packages.filter(canBeWritten);
  expect(written).not.toBeEmpty();
  try {
    await expectSameAnswerAsBunRun(writeProgram(written));
  } catch (error) {
    const red: Package[] = [];
    for (const it of written) {
      if (red.length === 6) break;
      await expectSameAnswerAsBunRun(writeProgram([it])).catch(() => red.push(it));
    }
    expect(red).toEqual([]);
    throw error;
  }
}

test("the package as it was first seen, once for each compiler option that differs", async () => {
  const [it] = cross(asFirstSeen);
  await expectPackagesToWork(otherOptions.map(compilerOptions => [it, compilerOptions]));
}, 120_000);

// No axis has a length that the stride divides. The sample has all but four of the 472 pairs of values of two axes that can be written.
test("a sample of all packages, with the compiler options in turn", async () => {
  const sample = [...cross(everyAxis)].filter((_, index) => index % 167 === 0);
  await expectPackagesToWork(sample.map((it, index) => [it, otherOptions[index % otherOptions.length]]));
}, 120_000);

// By a path of its own, through the index, and through the index beside a function of it.
const waysAcross = [
  (other: string) => `import type { Crate as Other } from "${other}/goods";\n`,
  (other: string) => `import type { Crate as Other } from "${other}";\n`,
  (other: string) =>
    `import type { Crate as Other } from "${other}";\nimport { twice as twiceOfOther } from "${other}";\nexport const kept = twiceOfOther;\n`,
];

test("two packages with compiler options of their own take each other's types", async () => {
  const writeSide = (
    name: string,
    other: string,
    nameOther: (other: string) => string,
    compilerOptions: Options,
  ): Files => ({
    [`node_modules/${name}/package.json`]: JSON.stringify({
      name,
      version: "1.0.0",
      type: "module",
      sideEffects: false,
      exports: { ".": "./src/index.ts", "./goods": "./src/goods.ts" },
    }),
    [`node_modules/${name}/tsconfig.json`]: JSON.stringify({ compilerOptions: { ...shared, ...compilerOptions } }),
    [`node_modules/${name}/src/index.ts`]:
      `export type { Crate } from "./goods.js";\nexport { PRICES } from "./goods.js";\n` +
      `export { isSought } from "./orders.js";\nexport { twice } from "./sums.js";\n`,
    [`node_modules/${name}/src/goods.ts`]:
      `import type { Crate as Other } from "${other}/goods";\n` +
      `export interface Crate { weight: number; labels: string[]; other?: Other }\n` +
      `export const PRICES: Record<string, number> = { a: 1, b: 2 };\n`,
    [`node_modules/${name}/src/orders.ts`]:
      `import type { Crate } from "./goods.js";\n` +
      nameOther(other) +
      `import { twice } from "./sums.js";\n` +
      `export function isSought(crate: Crate, other: Other): boolean { return crate.weight === other.weight || crate.labels.length === twice(other.labels.length); }\n`,
    [`node_modules/${name}/src/sums.ts`]: `export function twice(n: number): number { return n * 2; }\n`,
  });
  const program: Files = {
    "tsconfig.json": JSON.stringify({ compilerOptions: shared, include: ["main.ts"] }),
    "main.ts": `const [one, two] = [{ weight: 1, labels: ["x", "y"] }, { weight: 2, labels: ["z"] }];\n`,
  };
  for (const [index, nameOther] of waysAcross.entries()) {
    const [left, right] = [`left${index}`, `right${index}`];
    program["main.ts"] +=
      `import { isSought as ${left} } from "${left}";\nimport { isSought as ${right} } from "${right}";\n` +
      `console.log(${left}(one, two), ${left}(two, one), ${right}(one, two), ${right}(two, two));\n`;
    Object.assign(
      program,
      writeSide(left, right, nameOther, { lib: ["es2022"] }),
      writeSide(right, left, nameOther, { strictNullChecks: false }),
    );
  }
  await expectSameAnswerAsBunRun(program);
}, 120_000);
