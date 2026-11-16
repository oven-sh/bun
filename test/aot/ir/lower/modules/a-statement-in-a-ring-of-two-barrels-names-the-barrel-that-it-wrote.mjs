// leaf.mjs hands `format` on from outer.mjs by a statement. outer.mjs and inner.mjs both hold stars to CommonJS files, and they stand in one ring with leaf.mjs:
// outer.mjs stars inner.mjs, inner.mjs stars leaf.mjs. Only the run knows who brings the name, and the front end keeps one file of the ring to ask.
// The entry of leaf.mjs named that file, inner.mjs, and not the file that the statement wrote. Asked there the run finds leaf.mjs again and icons.cjs:
// dates.cjs, which has the name, stands behind the stars of outer.mjs alone: a valid program stopped at its start with "export 'format' not found".
// The entry and the name that the link asks for now name outer.mjs.
// RUN(LINKED): link
// LINKED: module {{*}}path="{{*}}/leaf.mjs"{{*}}exports=[{name="format" kind=Indirect module=m8 importName="format"}{{*}}requiredNames=[{module=m8 name="format"
// LINKED: module m8 path="{{*}}/outer.mjs"

// FILE: main.mjs
import * as outer from "./outer.mjs";
import * as inner from "./inner.mjs";
console.log(outer.format, inner.format);

// FILE: outer.mjs
export * from "./inner.mjs";
export * from "./dates.cjs";
export * from "./numbers.cjs";

// FILE: inner.mjs
export * from "./leaf.mjs";
export * from "./icons.cjs";

// FILE: leaf.mjs
export { format } from "./outer.mjs";
export const leaf = 1;

// FILE: dates.cjs
exports.format = 5;

// FILE: numbers.cjs
exports.round = 7;

// FILE: icons.cjs
exports.icon = 3;
