// A commonjs file requires the entry point inside a require of a module that imports the entry point.
// Plain Bun runs first.cjs and second.cjs in the order in which their texts come back from the threads of its transpiler: the lines are printed sorted.
import "./first.cjs";
import "./second.cjs";
globalThis.lines.push("main runs");
export const answer = 42;
process.on("exit", () => console.log(globalThis.lines.sort().join("\n")));
