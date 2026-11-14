const names = (exports.listed = ["one", "two"]);
require("./change.cjs");
for (const name of names) console.log("SAID", name, require(`./${name}.cjs`).name);
