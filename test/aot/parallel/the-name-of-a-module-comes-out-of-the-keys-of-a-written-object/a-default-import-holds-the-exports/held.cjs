const names = (exports.listed = ["one", "two"]);
exports.load = function () { for (const name of names) console.log("SAID", name, require(`./${name}.cjs`).name); };
