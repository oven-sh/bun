// A module that the program names through a value is whole: an export that no import names, a module that only a function nobody calls imports, and a module of the runtime under a computed name.
import { createRequire } from "node:module";
import { read } from "./library.js";

function uncalled() {
  return [uncalled, import("./lazy.js")];
}

const load = require;
console.log(read, load("./library.js").unread);
console.log(createRequire(import.meta.url)("./library.js").alsoUnread());
console.log(load("./lazy.js").value);
const parts = ["node:", "path"];
console.log(typeof process.getBuiltinModule(parts.join("")).join);
