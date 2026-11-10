// t.mjs takes `word` by a statement from a CommonJS file that may leave it empty, and a star of t.mjs has the name. The run drops the entry of t.mjs while it is empty and asks the stars of t.mjs.
// u.mjs hands `word` on from t.mjs. Its entry was bound to the same copy of the CommonJS name and marked the same way, but u.mjs has no stars: once it was dropped nobody answered, and `u.word` was undefined.
// RUN(LINKED): link
// LINKED: module {{*}}path="{{*}}/t.mjs"{{*}}exports=[{name="word" variable={{*}} isDroppedWhileEmpty=true}]
// LINKED: module {{*}}path="{{*}}/u.mjs"{{*}}exports=[{name="word" kind=Indirect module={{*}} importName="word"}]

// FILE: main.mjs
import * as u from "./u.mjs";
console.log(u.word);

// FILE: u.mjs
export { word } from "./t.mjs";

// FILE: t.mjs
export * from "./stars.mjs";
export { word } from "./lacks.cjs";

// FILE: stars.mjs
export const word = "es";

// FILE: lacks.cjs
exports.other = 1;
