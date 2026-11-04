// Todo: require() of a path that shows when the program runs answers the form read as JSON. The loader looks under every other type first, where the text lies
// A statement reads a file as JSON, an import() reads it as text, and require() asks for it under a path that the build does not know.
import t from "./d.json" with { type: "json" };
const n = await import("./d.json", { with: { type: "text" } });
const m = require(process.argv[2] ?? "./d.json");
console.log(typeof t, typeof n.default, typeof m, JSON.stringify(m.default ?? m));
