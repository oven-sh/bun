const names = (exports.listed = ["one", "two"]);
this.listed.push("extra");
for (const name of names) console.log("SAID", name, require(`./${name}.cjs`).name);
