// require() of type "macro" loads the file as it is, whether the type is written out or a constant holds it.
const kind = "macro";
console.log(Object.keys(require("./rules.mjs", { type: "macro" })).join());
console.log(Object.keys(require("./table.json", { type: kind })).join());
console.log(require("./other.cjs", { type: kind }).other, require("./more.json", { type: "macro" }).more);
