// A CommonJS file stores a name on its exports somewhere in its text: as a statement of its own, under an `if`, in a function, through a variable, under a key that is put together, by a
// definition. It has the flag of ES modules or not, the name is an ordinary one, `default`, or one that Object.prototype has too, and a definition under a key that nobody knows may stand beside
// it. Another file takes the name: by a star, by the default, by an import call, by require(), handed on by an ES module, or through a getter as TypeScript emits it.
// What a build reads off the text of such a file is what the file does when it runs.
const never = "process.argv.length > 5";
export const stores: Record<string, (n: string) => string> = {
  "a statement": n => `exports.${n} = 1;`,
  "under an if": n => `if (!(${never})) exports.${n} = 1;`,
  "an arm of a conditional": n => `${never} ? 0 : (exports.${n} = 1);`,
  "behind ||": n => `${never} || (exports.${n} = 1);`,
  "in a function": n => `function set() { exports.${n} = 1; }\nset();`,
  "in an arrow called at once": n => `(() => { exports.${n} = 1; })();`,
  "through a const": n => `const held = exports;\nheld.${n} = 1;`,
  "on module.exports": n => `module.exports.${n} = 1;`,
  "under a joined key": n => `exports["${n.slice(0, 2)}" + "${n.slice(2)}"] = 1;`,
  "under a key nobody knows": n => `exports[${never} ? "x" : "${n}"] = 1;`,
  "defined as a value": n => `Object.defineProperty(exports, "${n}", { value: 1, enumerable: true });`,
  "defined as a getter": n =>
    `Object.defineProperty(exports, "${n}", { enumerable: true, get: function () { return 1; } });`,
  "defined and hidden": n => `Object.defineProperty(exports, "${n}", { value: 1 });`,
  "assigned": n => `Object.assign(exports, { ${n}: 1 });`,
  "in a loop": n => `for (const key of ["${n}"]) exports[key] = 1;`,
  "in a try": n => `try { exports.${n} = 1; } finally {}`,
  "a new exports": n => `module.exports = { ${n}: 1 };`,
  "a new exports under an if": n => `if (!(${never})) module.exports = { ${n}: 1 };`,
  "on this": n => `this.${n} = 1;`,
};
const show = (ns: string) =>
  `console.log(JSON.stringify([Object.keys(${ns}).sort(), ${ns}.value, ${ns}.default === undefined ? "none" : ${ns}.default, "value" in ${ns}, typeof ${ns}.constructor === "number" ? ${ns}.constructor : typeof ${ns}.constructor]));`;
const getter = (from: string, n: string) =>
  `"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nvar below_1 = require("${from}");\nObject.defineProperty(exports, "${n}", { enumerable: true, get: function () { return below_1.${n}; } });\n`;
export const importers: Record<string, (n: string) => Record<string, string>> = {
  "a star": () => ({ "main.mjs": `import * as names from "./lib.cjs";\n${show("names")}\n` }),
  "the default": () => ({ "main.mjs": `import whole from "./lib.cjs";\nconsole.log(JSON.stringify(whole));\n` }),
  "an import call": () => ({ "main.mjs": `const names = await import("./lib.cjs");\n${show("names")}\n` }),
  "require": () => ({ "main.cjs": `const names = require("./lib.cjs");\n${show("names")}\n` }),
  "a star handed on": () => ({
    "main.mjs": `import * as names from "./between.mjs";\n${show("names")}\n`,
    "between.mjs": `export * from "./lib.cjs";\n`,
  }),
  "the name handed on": n => ({
    "main.mjs": `import * as names from "./between.mjs";\n${show("names")}\n`,
    "between.mjs": `export { ${n} } from "./lib.cjs";\n`,
  }),
  "a getter over the name handed on": n => ({
    "main.mjs": `import * as names from "./over.cjs";\n${show("names")}\n`,
    "over.cjs": getter("./between.mjs", n),
    "between.mjs": `export { ${n} } from "./lib.cjs";\n`,
  }),
  "the default of a getter over the name handed on": n => ({
    "main.mjs": `import whole from "./over.cjs";\nconsole.log(JSON.stringify(whole));\n`,
    "over.cjs": getter("./between.mjs", n),
    "between.mjs": `export { ${n} } from "./lib.cjs";\n`,
  }),
  "the default of a getter over the file": n => ({
    "main.mjs": `import whole from "./over.cjs";\nconsole.log(JSON.stringify(whole));\n`,
    "over.cjs": getter("./lib.cjs", n),
  }),
  "the default handed on": () => ({
    "main.mjs": `import whole from "./between.mjs";\nconsole.log(JSON.stringify(whole));\n`,
    "between.mjs": `export { default } from "./lib.cjs";\n`,
  }),
  "a getter over the file": n => ({
    "main.mjs": `import * as names from "./over.cjs";\n${show("names")}\n`,
    "over.cjs": getter("./lib.cjs", n),
  }),
};
export const names = ["value", "default", "constructor"];
export const besides = [
  "",
  `Object.defineProperty(exports, ${never} ? process.argv[5] : "two", { value: 2, enumerable: true });\n`,
];

export function filesOf(
  store: string,
  hasFlag: boolean,
  name: string,
  beside: string,
  importer: string,
): Record<string, string> {
  return {
    "lib.cjs": `${hasFlag ? 'Object.defineProperty(exports, "__esModule", { value: true });\n' : ""}exports.other = 2;\n${stores[store](name)}\n${beside}`,
    ...importers[importer](name),
  };
}
