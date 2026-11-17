// left.mjs and right.mjs each hand `made` on by a statement from one CommonJS file, whose names only the run knows, and each holds a star besides. Should the file end without the name, the star may bring it:
// so the name is read off the object of left.mjs at the run. No file here has a star that the run follows, and main.mjs reads names off outer.mjs one by one: the pass that finds which names are asked trimmed all three.
// The reach looked at their objects, the two passes parted, and the compiler stopped: "something looks at the object of left.mjs, and nobody was seen to ask for all that `export *` brings it".
// A file with stars that hands on a name which only the run knows, and every barrel with stars above it, is now asked whole.
// RUN(LINKED): link
// LINKED: module {{*}}path="{{*}}/outer.mjs"

// FILE: main.mjs
import * as outer from "./outer.mjs";
console.log(outer.made, outer.far);

// FILE: outer.mjs
export * from "./left.mjs";
export * from "./right.mjs";

// FILE: left.mjs
export { made } from "./loose.cjs";
export * from "./far.mjs";

// FILE: right.mjs
export { made } from "./loose.cjs";
export * from "./near.mjs";

// FILE: far.mjs
export const far = 1;
export const farther = 2;

// FILE: near.mjs
export const near = 3;
export const nearer = 4;

// FILE: loose.cjs
const all = {};
all["ma" + String.fromCharCode(100, 101)] = 5;
module.exports = all;
