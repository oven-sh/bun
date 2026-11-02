// An ES module imports names of CommonJS modules that re-export others, `export * from` as TypeScript emits it, and other code stores names to what they export: `tag`, which no star binds, and `two`, which the star binds.
// COUNTER: StarsRecorded >= 3
import { one, two, own } from "./free.cjs";
import { one as boundOne, two as boundTwo, own as boundOwn } from "./bound.cjs";
import { one as outerOne, two as outerTwo, own as outerOwn } from "./outer.cjs";
import { storeTag, storeTwo, exportsOf } from "./stores.cjs";
const list = names => Object.keys(names).map(key => key + "=" + (typeof names[key] === "object" ? "object" : names[key])).join(" ");
console.log(one, "|", two, "|", own);
console.log(boundOne, "|", boundTwo, "|", boundOwn);
console.log(outerOne, "|", outerTwo, "|", outerOwn);
console.log(list(await import("./free.cjs")));
console.log(list(await import("./bound.cjs")));
console.log(list(await import("./outer.cjs")));
console.log(storeTag(exportsOf("free")), storeTwo(exportsOf("bound")), storeTwo(exportsOf("outer")));
console.log(list(exportsOf("free")), "|", list(exportsOf("bound")), "|", list(exportsOf("outer")));
console.log(two, "|", boundTwo, "|", outerTwo);
