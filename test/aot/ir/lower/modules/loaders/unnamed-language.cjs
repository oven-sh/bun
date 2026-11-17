// RUN: lower
// STATISTIC: SourceFilesChecked = 3
// STATISTIC: SourceFilesDemoted = 1

// Nothing names the language of these files, and `bun run` reads each as TypeScript. The one that is JavaScript too is held to no rule of TypeScript, and nothing goes by its types.

// FILE: main.cjs
const load = require;
console.log(load("./plain.bin"), load("./annotated.conf"), load("./enumerated.conf"), load("./asked.conf"));

// FILE: plain.bin
const made = {};
made.sloppy = (function (given) { return this !== given; })();
module.exports = made;

// FILE: annotated.conf
export const annotated: number = 1;

// FILE: enumerated.conf
export enum Kind { First }

// FILE: asked.conf
// @ts-check
export const asked = 1;
