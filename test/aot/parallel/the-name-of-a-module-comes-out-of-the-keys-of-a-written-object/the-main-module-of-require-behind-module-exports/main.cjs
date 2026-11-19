const names = (module.exports = ["one", "two"]);
require.main.exports.push("extra");
for (const name of names) console.log("SAID", name, require(`./${name}.cjs`).name);
