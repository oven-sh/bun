// A statement reads a file as JSON, an import() reads it as text, and require() asks for it under a path that the build does not know.
// Under `bun <file>` the loader looks under every other type first, where the text lies. The executable answered the form read as JSON.
// A file that require() has answered before keeps that answer, whatever is imported behind it.
import t from "./d.json" with { type: "json" };
const show = it => JSON.stringify(it.default ?? it);
const n = await import("./d.json", { with: { type: "text" } });
console.log(typeof t, typeof n.default, show(require(process.argv[2] ?? "./d.json")), show(require(process.argv[2] ?? "./d.json")));
const before = require(process.argv[3] ?? "./e.json");
const text = await import("./e.json", { with: { type: "text" } });
console.log(show(before), typeof text.default, show(require(process.argv[3] ?? "./e.json")));
