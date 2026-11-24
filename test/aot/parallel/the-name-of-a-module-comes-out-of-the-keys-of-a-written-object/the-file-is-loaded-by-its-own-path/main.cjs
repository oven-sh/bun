const names = (exports.listed = ["one", "two"]);
require(__filename).listed.push("extra");
for (const name of names) console.log("SAID", name, require(`./${name}.cjs`).name);
