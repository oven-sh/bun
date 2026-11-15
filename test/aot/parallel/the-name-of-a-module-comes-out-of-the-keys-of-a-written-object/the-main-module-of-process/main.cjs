const names = (exports.listed = ["one", "two"]);
process.mainModule.exports.listed.push("extra");
for (const name of names) console.log("SAID", name, require(`./${name}.cjs`).name);
