// Imports of packages whose package.json says "sideEffects": false: docs/compiler/compatibility.mdx, "Packages".
// An executable is bundled, and the bundler takes the package at its word: an import that nothing is used of goes, and the file never runs. `bun run` runs every file.
// Each form has a package of its own, because one name that is used keeps the file for all. With --aot an executable drops what it drops without.
// Reference: bun build --compile
import "bare-commonjs";
import "bare-esm";
import { x as unusedOfCommonJS } from "unused-name-commonjs";
import { x as unusedOfESM } from "unused-name-esm";
import * as unusedNamespace from "unused-namespace";
import { x as usedOfCommonJS } from "used-name-commonjs";
import { x as usedOfESM } from "used-name-esm";
import "lists-a-file";
import "lists-a-file/setup.js";
import "imports-a-loud-one";
import "./own/setup.mjs";

console.log("the program begins", usedOfCommonJS, usedOfESM);
require("required");
await import("imported-by-call");
console.log("the program ends");
