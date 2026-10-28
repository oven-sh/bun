// What module.id, module.filename and require.main are in CommonJS files that an ES module imports and loads with import(). Two of the files require each other.
import * as first from "./first.js";
const second = await import("./second.js");
console.log("main:", first.name, second.default.name, import.meta.main);
