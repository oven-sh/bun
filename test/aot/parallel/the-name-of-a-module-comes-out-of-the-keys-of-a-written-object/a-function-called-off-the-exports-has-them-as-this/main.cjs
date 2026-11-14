const names = (exports.listed = ["one", "two"]);
exports.grow = function () { this.listed.push("extra"); };
exports.grow();
for (const name of names) console.log("SAID", name, require(`./${name}.cjs`).name);
