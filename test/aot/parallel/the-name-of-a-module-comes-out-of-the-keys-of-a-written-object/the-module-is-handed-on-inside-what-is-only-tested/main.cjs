const names = (exports.listed = ["one", "two"]);
const take = it => it.exports.listed.push("extra"); !take(module);
for (const name of names) console.log("SAID", name, require(`./${name}.cjs`).name);
