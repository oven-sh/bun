// A name is imported from a module that the build leaves outside. The engine binds it without the namespace object, so whoever shows that object first says whether it takes new
// properties: require() makes one that does, an import one that does not, and whoever comes second gets the same object.
// Flags: --external required --external imported --external required-first --external imported-first
import { a as one } from "required";
import { a as two } from "imported";
import { a as three } from "required-first";
import { a as four } from "imported-first";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
console.log(one + two + three + four);
console.log("require()", Object.isExtensible(require("required")));
console.log("import()", Object.isExtensible(await import("imported")));
const required = require("required-first");
console.log("require(), then import()", Object.isExtensible(required), Object.isExtensible(await import("required-first")), required === (await import("required-first")));
const imported = await import("imported-first");
console.log("import(), then require()", Object.isExtensible(imported), Object.isExtensible(require("imported-first")), imported === require("imported-first"));
