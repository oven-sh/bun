// A CommonJS file makes its exports in one of many ways: stores on `exports`, a literal in place of `module.exports`, definitions of values and
// of getters, with and without `__esModule`, and the helpers that TypeScript and esbuild write. Another module takes them in one of many ways:
// the default, names, the namespace, a key, `import()`, `require`, or through a module that hands them on. Then it reads them, calls them
// through what it took and bare, hands them on, lists them, and does the same again once the file has changed what it exports.
import type { Random } from "./random";

// Every file exports `value`, `readsThis`, `callsThis` and `plain`; some export `count` and `bump`, which changes `count`.
const steadyNames = [`value`, `readsThis`, `callsThis`, `plain`];
const changingNames = [`count`, `bump`];
const steadyBindings = [
  `function readsThis() {\n  return this === undefined ? "no this" : typeof this.value + " " + typeof this.plain;\n}`,
  `function callsThis() {\n  return this.plain();\n}`,
  `function plain() {\n  return "plain";\n}`,
];
const changingBindings = [`let count = 0;`, `function bump() {\n  count++;\n  return count;\n}`];

const marker = `Object.defineProperty(exports, "__esModule", { value: true });`;
const typescriptHelpers = [
  `var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {`,
  `    if (k2 === undefined) k2 = k;`,
  `    var desc = Object.getOwnPropertyDescriptor(m, k);`,
  `    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {`,
  `      desc = { enumerable: true, get: function() { return m[k]; } };`,
  `    }`,
  `    Object.defineProperty(o, k2, desc);`,
  `}) : (function(o, m, k, k2) {`,
  `    if (k2 === undefined) k2 = k;`,
  `    o[k2] = m[k];`,
  `}));`,
  `var __exportStar = (this && this.__exportStar) || function(m, exports) {`,
  `    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);`,
  `};`,
].join("\n");
const esbuildHelpers = [
  `var __defProp = Object.defineProperty;`,
  `var __getOwnPropDesc = Object.getOwnPropertyDescriptor;`,
  `var __getOwnPropNames = Object.getOwnPropertyNames;`,
  `var __hasOwnProp = Object.prototype.hasOwnProperty;`,
  `var __export = (target, all) => {`,
  `  for (var name in all)`,
  `    __defProp(target, name, { get: all[name], enumerable: true });`,
  `};`,
  `var __copyProps = (to, from, except, desc) => {`,
  `  if (from && typeof from === "object" || typeof from === "function") {`,
  `    for (let key of __getOwnPropNames(from))`,
  `      if (!__hasOwnProp.call(to, key) && key !== except)`,
  `        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });`,
  `  }`,
  `  return to;`,
  `};`,
  `var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);`,
].join("\n");
const olderEsbuildHelpers = [
  `var __defProp = Object.defineProperty;`,
  `var __markAsModule = (target) => __defProp(target, "__esModule", { value: true });`,
  `var __export = (target, all) => {`,
  `  __markAsModule(target);`,
  `  for (var name in all)`,
  `    __defProp(target, name, { get: all[name], enumerable: true });`,
  `};`,
].join("\n");

interface Made {
  lines: string[];
  /** More files, by name. `FILE` in them is the request for the file itself. */
  files?: Record<string, string>;
}
// `bindings` declares everything but `value`.
type Maker = (names: readonly string[], bindings: string) => Made;

const each = (names: readonly string[], write: (name: string) => string) => names.map(write).join("\n");
const getters = (names: readonly string[], target: string) =>
  each(
    names,
    name => `Object.defineProperty(${target}, "${name}", { enumerable: true, get: function () { return ${name}; } });`,
  );
const arrows = (names: readonly string[]) => `{\n${names.map(name => `  ${name}: () => ${name}`).join(",\n")}\n}`;
const writeInner: Maker = (names, bindings) => ({
  lines: [`"use strict";`, marker, getters(names, `exports`), `const value = 1;`, bindings],
});
const withInner = (names: readonly string[], bindings: string) => ({
  "inner.cjs": writeInner(names, bindings).lines.join("\n") + "\n",
});
const early = `try {\n  console.log("early", SEEN.value);\n} catch (error) {\n  console.log("early", error.name);\n}`;

const makers: readonly Maker[] = [
  (names, bindings) => ({ lines: [`const value = 1;`, bindings, each(names, name => `exports.${name} = ${name};`)] }),
  (names, bindings) => ({ lines: [`const value = 1;`, bindings, `module.exports = { ${names.join(", ")} };`] }),
  (names, bindings) => ({
    lines: [`const value = 1;`, bindings, each(names, name => `module.exports.${name} = ${name};`)],
  }),
  (names, bindings) => ({
    lines: [
      `const value = 1;`,
      bindings,
      `exports.__esModule = true;`,
      each(names, name => `exports.${name} = ${name};`),
    ],
  }),
  (names, bindings) => ({
    lines: [
      `const value = 1;`,
      bindings,
      each(names, name => `Object.defineProperty(exports, "${name}", { value: ${name}, enumerable: true });`),
    ],
  }),
  writeInner,
  (names, bindings) => ({ lines: [getters(names, `exports`), `const value = 1;`, bindings] }),
  (names, bindings) => ({
    lines: [`"use strict";`, marker, getters(names, `module.exports`), `var value = 1;`, bindings],
  }),
  (names, bindings) => ({ lines: [...writeInner(names, bindings).lines, `exports.default = "own default";`] }),
  (names, bindings) => ({
    lines: [
      `"use strict";`,
      marker,
      `exports.${names.join(" = exports.")} = void 0;`,
      `const value = 1;`,
      bindings,
      each(names, name => `exports.${name} = ${name};`),
    ],
  }),
  (names, bindings) => ({
    lines: [`"use strict";`, typescriptHelpers, marker, `__exportStar(require("./inner.cjs"), exports);`],
    files: withInner(names, bindings),
  }),
  (names, bindings) => ({
    lines: [
      `"use strict";`,
      typescriptHelpers,
      marker,
      `var inner_1 = require("./inner.cjs");`,
      each(names, name => `__createBinding(exports, inner_1, "${name}");`),
    ],
    files: withInner(names, bindings),
  }),
  (names, bindings) => ({
    lines: [
      `"use strict";`,
      marker,
      `var inner_1 = require("./inner.cjs");`,
      each(
        names,
        name =>
          `Object.defineProperty(exports, "${name}", { enumerable: true, get: function () { return inner_1.${name}; } });`,
      ),
    ],
    files: withInner(names, bindings),
  }),
  (names, bindings) => ({
    lines: [
      esbuildHelpers,
      `var file_exports = {};`,
      `__export(file_exports, ${arrows(names)});`,
      `module.exports = __toCommonJS(file_exports);`,
      `var value = 1;`,
      bindings,
    ],
  }),
  (names, bindings) => ({
    lines: [olderEsbuildHelpers, `__export(exports, ${arrows(names)});`, `var value = 1;`, bindings],
  }),
  (names, bindings) => ({
    lines: [
      `const value = 1;`,
      bindings,
      `module.exports = {\n${names.map(name => (name === `value` || name === `count` ? `  get ${name}() {\n    return ${name};\n  },` : `  ${name},`)).join("\n")}\n};`,
    ],
  }),
  (names, bindings) => ({
    lines: [
      `const value = 1;`,
      bindings,
      `module.exports = function made() {\n  return "made";\n};`,
      `Object.assign(module.exports, { ${names.join(", ")} });`,
    ],
  }),
  // What a getter returns is asked for while the name is not yet initialized.
  (names, bindings) => ({
    lines: [
      `"use strict";`,
      marker,
      getters(names, `exports`),
      early.replace(`SEEN`, `exports`),
      `const value = 1;`,
      bindings,
    ],
  }),
  (names, bindings) => ({
    lines: [
      `"use strict";`,
      marker,
      getters(names, `exports`),
      `require("./early.cjs");`,
      `const value = 1;`,
      bindings,
    ],
    files: {
      "early.cjs": [
        `const file = require(FILE);`,
        early.replace(`SEEN`, `file`),
        `console.log("early", typeof file.plain, Object.keys(file).join());`,
        ``,
      ].join("\n"),
    },
  }),
];

// `of(name)` is how the module gets at a name; `whole` is an expression for what it holds as one thing, if it looks at such a thing.
interface Taker {
  head: (names: readonly string[]) => string;
  of: (name: string) => string;
  whole?: string;
  isCommonJs?: boolean;
}
const list = (names: readonly string[]) => names.join(", ");
const takers: readonly Taker[] = [
  { head: () => `import whole from FROM;`, of: name => `whole.${name}`, whole: `whole` },
  { head: () => `import whole from FROM;`, of: name => `whole.${name}` },
  { head: names => `import { ${list(names)} } from FROM;`, of: name => name },
  { head: names => `import whole, { ${list(names)} } from FROM;`, of: name => name, whole: `whole` },
  { head: () => `import * as all from FROM;`, of: name => `all.${name}` },
  { head: () => `import * as all from FROM;`, of: name => `all.${name}`, whole: `all` },
  { head: () => `import * as all from FROM;`, of: name => `all["${name}"]` },
  {
    head: () => `import * as all from FROM;\nconst key = name => name;`,
    of: name => `all[key("${name}")]`,
    whole: `all`,
  },
  { head: () => `import * as all from FROM;`, of: name => `all.default.${name}`, whole: `all.default` },
  { head: names => `import * as all from FROM;\nimport { ${list(names)} } from FROM;`, of: name => name, whole: `all` },
  { head: () => `import whole from FROM;\nimport * as all from FROM;`, of: name => `all.${name}`, whole: `whole` },
  { head: () => `const all = await import(FROM);`, of: name => `all.${name}`, whole: `all` },
  { head: () => `const all = await import(FROM);`, of: name => `all.${name}` },
  { head: names => `const { ${list(names)} } = await import(FROM);`, of: name => name },
  { head: () => `const { default: whole } = await import(FROM);`, of: name => `whole.${name}`, whole: `whole` },
  { head: () => `const all = require(FROM);`, of: name => `all.${name}`, isCommonJs: true },
  { head: () => `const all = require(FROM);`, of: name => `all.${name}`, whole: `all`, isCommonJs: true },
  { head: () => `const all = require(FROM);`, of: name => `all["${name}"]`, isCommonJs: true },
  { head: names => `const { ${list(names)} } = require(FROM);`, of: name => name, isCommonJs: true },
  {
    head: () => `import { createRequire } from "node:module";\nconst all = createRequire(import.meta.url)(FROM);`,
    of: name => `all.${name}`,
    whole: `all`,
  },
];

const hands: readonly ((names: readonly string[]) => string)[] = [
  () => `export * from FROM;`,
  names => `export { ${list(names)} } from FROM;`,
  names => `export { ${list(names)}, default } from FROM;`,
  () => `export * from FROM;\nexport { default } from FROM;`,
  names => `import * as all from FROM;\nexport const { ${list(names)} } = all;\nexport default all;`,
  names => `import { ${list(names)} } from FROM;\nexport { ${list(names)} };`,
  () => `import whole from FROM;\nexport default whole;\nexport * from FROM;`,
];

const show = `function show(label, read) {
  try {
    const got = read();
    console.log(label, typeof got === "function" ? "a function" : typeof got === "object" && got !== null ? Object.keys(got).join() : String(got));
  } catch (error) {
    console.log(label, "threw", error.name);
  }
}`;

function writeUses(random: Random, taker: Taker, changes: boolean): string[] {
  const { of, whole } = taker;
  const uses = [
    `show("value", () => ${of(`value`)});`,
    `show("reads this", () => ${of(`readsThis`)}());`,
    `show("calls this", () => ${of(`callsThis`)}());`,
    `show("plain", () => ${of(`plain`)}());`,
    `show("bare", () => (0, ${of(`readsThis`)})());`,
    `show("held", () => {\n  const held = ${of(`readsThis`)};\n  return held();\n});`,
    `show("on another", () => ${of(`readsThis`)}.call({ value: "text" }));`,
    `show("handed on", () => [${of(`plain`)}].map(each => each()).join());`,
    `show("tagged", () => ${of(`readsThis`)}\`\`);`,
    `show("optional", () => ${of(`callsThis`)}?.());`,
    `show("kind", () => typeof ${of(`plain`)});`,
  ];
  if (whole) {
    uses.push(
      `show("whole", () => ${whole});`,
      `show("keys", () => Object.keys(${whole}).sort().join());`,
      `show("names", () => Object.getOwnPropertyNames(${whole}).sort().join());`,
      `show("has", () => "value" in ${whole});`,
      `show("marked", () => String(${whole}.__esModule));`,
      `show("spread", () => ({ ...${whole} }));`,
      `show("through the whole", () => ${whole}.readsThis());`,
      `show("is the same", () => ${whole}.plain === ${of(`plain`)});`,
      `show("described", () => Object.keys(Object.getOwnPropertyDescriptor(${whole}, "value") ?? {}).sort().join());`,
      `show("in a loop", () => {\n  const seen = [];\n  for (const name in ${whole}) seen.push(name);\n  return seen.sort().join();\n});`,
    );
  }
  const taken = random.sample(uses, random.between(1, 5));
  if (!changes) return taken;
  return [
    `show("count", () => ${of(`count`)});`,
    ...taken,
    `show("bump", () => ${of(`bump`)}());`,
    `show("count afterwards", () => ${of(`count`)});`,
  ];
}

export function generate(random: Random): { file: string; text: string; files: Record<string, string> } {
  const files: Record<string, string> = {};
  const changes = random.chance(0.3);
  const names = changes ? [...steadyNames, ...changingNames] : steadyNames;
  const bindings = [...(changes ? changingBindings : []), ...steadyBindings].join("\n");
  const made = random.pick(makers)(names, bindings);
  const kind = random.weighted([
    [3, `cjs`],
    [1, `js`],
    [1, `cts`],
  ] as const);
  const folder = kind === `js` ? `package/` : ``;
  const fileName = `${folder}file.${kind}`;
  if (kind === `js`) files[`package/package.json`] = `{ "type": "commonjs" }\n`;
  files[fileName] = [...(kind === `cts` ? [`// @ts-nocheck`] : []), ...made.lines, ``].join("\n");
  for (const [name, text] of Object.entries(made.files ?? {})) {
    files[folder + name] = text.replaceAll(`FILE`, JSON.stringify(`./file.${kind}`));
  }

  let from = `./${fileName}`;
  let hasDefault = true;
  if (random.chance(0.3)) {
    const isTyped = random.chance(0.5);
    const hand = random.pick(hands)(names);
    const name = `hands-on.${isTyped ? `ts` : `mjs`}`;
    files[name] = [...(isTyped ? [`// @ts-nocheck`] : []), hand.replaceAll(`FROM`, JSON.stringify(from)), ``].join(
      "\n",
    );
    from = `./${name}`;
    hasDefault = hand.includes(`default`);
  }

  const needsDefault = (taker: Taker) => /\bwhole\b|default/.test(taker.head(names) + taker.of(`value`));
  const taker = random.pick(takers.filter(taker => hasDefault || taker.isCommonJs || !needsDefault(taker)));
  const isTyped = !taker.isCommonJs && random.chance(0.5);
  const text = [
    ...(isTyped ? [`// @ts-nocheck`] : []),
    taker.head(names).replaceAll(`FROM`, JSON.stringify(from)),
    show,
    ...writeUses(random, taker, changes),
    ``,
  ].join("\n");
  return { file: taker.isCommonJs ? `main.cjs` : isTyped ? `main.ts` : `main.mjs`, text, files };
}
