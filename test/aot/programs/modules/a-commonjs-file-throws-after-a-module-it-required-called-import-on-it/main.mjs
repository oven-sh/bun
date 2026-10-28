// throws.cjs runs while the graph of this entry point is loaded. The module that it requires calls import() on it, so the loader has the file, with what it had exported by then, before the file throws.
import "./throws.cjs";
import "./deeper.mjs";
console.log("main runs");
