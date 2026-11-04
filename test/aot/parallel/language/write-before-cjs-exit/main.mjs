// The import that writes to a locked built-in comes first, but a CommonJS file that an ES module imports runs while the graph is loaded. It calls process.exit(), so the write is never reached.
import "./patch.mjs";
import "./exit.cjs";
console.log("never");
