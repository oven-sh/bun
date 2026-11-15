const text = require("./part.mjs", { type: "text" });
const r = require("./part.mjs");
console.log(r === text, Object.keys(r).join());
import("./part.mjs").then(n => console.log(Object.keys(n).join()));
