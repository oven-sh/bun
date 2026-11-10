const names = (exports.listed = ["one", "two"]);
arguments[0].listed.push("extra");
for (const name of names) console.log("SAID", name, require(`./${name}.cjs`).name);
