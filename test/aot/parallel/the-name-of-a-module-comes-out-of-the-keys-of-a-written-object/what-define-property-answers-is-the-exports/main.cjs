const names = (exports.listed = ["one", "two"]);
Object.defineProperty(exports, "mark", { value: 1 }).listed.push("extra");
for (const name of names) console.log("SAID", name, require(`./${name}.cjs`).name);
