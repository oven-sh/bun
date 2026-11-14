const names = (exports.listed = ["one", "two"]);
let kept; !(kept = module); kept.exports.listed.push("extra");
for (const name of names) console.log("SAID", name, require(`./${name}.cjs`).name);
