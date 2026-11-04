// Todo: the namespace of a file imported with { type: "file" } lacks the name __esModule
// Prints the names of the module that an import() with { type: "file" } gets, beside a statement that reads the same file as JSON.
import "./d.json" with { type: "json" };
const n = await import("./d.json", { with: { type: "file" } });
console.log(typeof n.default, Object.keys(n).sort().join());
