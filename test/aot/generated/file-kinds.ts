// What kind is this file? Bun's parser decides by marks in the text, by the file's name and by package.json whether a file is an ES
// module (strict) or CommonJS (sloppy), and the front end of --aot decides for itself. Here is every single mark and every pair of 19
// marks, in 7 settings, in 3 roles: the main file, imported, required.
//
// What is asked disturbs nothing: `typeof this` in a plain call of a function, which tells strict from sloppy, and what the importer
// or requirer sees: the keys and the type of `default`. Asking `typeof module` would itself be a mark.
const marks: Record<string, string> = {
  R: 'const r_ = require("node:path");',
  M: "module.exports = { m: 1 };",
  E: "exports.e = 1;",
  I: 'import "node:os";',
  X: "export const x = 1;",
  A: "await null;",
  U: "const u_ = import.meta.url;",
  D: "const d_ = __dirname;",
  F: "const f_ = __filename;",
  S: '"use strict";',
  T: "const t_ = this;",
  Y: "const y_ = typeof module;",
  Z: "const z_ = typeof require;",
  W: "const w_ = typeof exports;",
  L: "function local_(module, exports) { return module; }",
  G: "const g_ = require.main;",
  V: "export {};",
  N: 'import * as n_ from "node:os";',
  C: 'const c_ = import("node:os");',
};
const marksInTypeScript: Record<string, string> = {
  ...marks,
  T: "const t_: unknown = this;",
  L: "function local_(module: unknown, exports: unknown) { return module; }",
  E: "(exports as any).e = 1;",
  I: 'import "./side";',
  N: 'import * as n_ from "./side";',
  C: 'const c_ = import("./side");',
};
/** The order in which two marks stand in a text. */
const order = "SIRMEXAUDFTYZWLGVNC";

export const settings: Record<string, { extension: string; type?: string }> = {
  "js": { extension: "js" },
  "js-module": { extension: "js", type: "module" },
  "js-commonjs": { extension: "js", type: "commonjs" },
  "mjs": { extension: "mjs" },
  "cjs": { extension: "cjs" },
  "ts": { extension: "ts" },
  "ts-module": { extension: "ts", type: "module" },
};

const letters = Object.keys(marks);
/** "none", each mark, and each pair of marks. */
export const texts = [
  "none",
  ...letters,
  ...letters.flatMap((a, i) => letters.slice(i + 1).map(b => (order.indexOf(a) < order.indexOf(b) ? a + b : b + a))),
];

function around(setting: string) {
  const { extension, type } = settings[setting];
  const isTypeScript = extension === "ts";
  const body = (text: string) => (text === "none" ? [] : [...text]).map(mark => (isTypeScript ? marksInTypeScript : marks)[mark]).join("\n");
  const files: Record<string, string> = {};
  if (type) files["package.json"] = `{ "type": "${type}" }\n`;
  if (isTypeScript) files["side.ts"] = "export {};\n";
  return { extension, isTypeScript, body, files, probe: isTypeScript ? "(function (this: unknown) { return typeof this; })()" : "(function () { return typeof this; })()" };
}

/** The text as the main file. It prints its name and "undefined" (strict) or "object" (sloppy). */
export function asMain(setting: string, text: string): { file: string; text: string; files: Record<string, string> } {
  const { extension, body, files, probe } = around(setting);
  return { file: `main.${extension}`, text: `${body(text)}\nconsole.log("${text}", ${probe});\n`, files };
}

const see =
  'const see_ = v => v === null || (typeof v !== "object" && typeof v !== "function") ? typeof v : Object.keys(v).sort().join("+") + ":" + typeof v.default;';

/**
 * One program that imports, or requires, each of the texts and prints a line for each: its name, strict or sloppy, and what came of
 * it; or its name, "FAILS" and the kind of error.
 */
export function asLibraries(setting: string, role: "imported" | "required", chosen: string[]): { file: string; text: string; files: Record<string, string> } {
  const { extension, isTypeScript, body, files, probe } = around(setting);
  for (const text of texts) files[`lib_${text}.${extension}`] = `${body(text)}\n${isTypeScript ? "(globalThis as any)" : "globalThis"}.report_("${text}", ${probe});\n`;
  if (role === "imported") {
    const lines = chosen.map(
      text => `said_ = "silent"; await import("./lib_${text}.${extension}").then(ns => console.log("${text}", said_, see_(ns)), e => console.log("${text}", "FAILS", e.constructor.name));`,
    );
    return { file: "imported.mjs", text: `export {}; let said_ = ""; globalThis.report_ = (id, v) => { said_ = v; };\n${see}\n${lines.join("\n")}\n`, files };
  }
  const lines = chosen.map(
    text => `said_ = "silent"; try { const v = require("./lib_${text}.${extension}"); console.log("${text}", said_, see_(v)); } catch (e) { console.log("${text}", "FAILS", e.constructor.name); }`,
  );
  return { file: "required.cjs", text: `let said_ = ""; globalThis.report_ = (id, v) => { said_ = v; }; module.exports = 1;\n${see}\n${lines.join("\n")}\n`, files };
}
