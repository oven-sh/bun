// The exports that only a typed require() of the module shows
import code from "./part.mjs";
const path = require("./part.mjs", { type: "file" });
console.log(code, JSON.stringify(path), globalThis.ran);
