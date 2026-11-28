// Reference: bun build --compile
// A file without code has no body to run. A statement has loaded it all the same, so a require() without a type answers with the file.
import "./stub.js";
import asked from "./asks.cjs";
console.log(typeof asked.path, typeof asked.plain, Object.keys(asked.plain).length);
