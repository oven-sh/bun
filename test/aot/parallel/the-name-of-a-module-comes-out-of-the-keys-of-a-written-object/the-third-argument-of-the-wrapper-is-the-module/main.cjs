const names = (module.exports = ["one", "two"]);
arguments[2].exports.push("extra");
for (const name of names) console.log("SAID", name, require(`./${name}.cjs`).name);
