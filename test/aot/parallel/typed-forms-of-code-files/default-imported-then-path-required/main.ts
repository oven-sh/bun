// The exports that only a typed require() of the file shows
import code from "./part.cjs";
const path = require("./part.cjs", { type: "file" });
const text = require("./part.cjs", { type: "text" });
console.log(code, JSON.stringify(path), path === text, globalThis.ran);
