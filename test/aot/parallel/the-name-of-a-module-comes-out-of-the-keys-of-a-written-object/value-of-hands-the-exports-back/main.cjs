const names = (exports.listed = ["one", "two"]);
exports.valueOf().listed.push("extra");
for (const name of names) console.log("SAID", name, require(`./${name}.cjs`).name);
