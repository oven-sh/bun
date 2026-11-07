// plain.js is CommonJS by its package, to every loader. The bundle alone runs it strict.
import "./plain.js";
console.log(globalThis.seen.join(" "));
