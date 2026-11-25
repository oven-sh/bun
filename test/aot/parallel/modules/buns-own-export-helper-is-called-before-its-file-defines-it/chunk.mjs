import { lay } from "./helpers.mjs";
var names = {};
lay(names, { a: () => 1 });
console.log(Object.keys(names));
