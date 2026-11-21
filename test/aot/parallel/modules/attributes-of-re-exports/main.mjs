// The attributes of a re-export choose no type: the file loads under its own.
import { rows, notes } from "./shelf.mjs";
import { held } from "./held.mjs";
console.log(typeof rows, JSON.stringify(rows), typeof notes, notes.trim(), JSON.stringify(held.default));
