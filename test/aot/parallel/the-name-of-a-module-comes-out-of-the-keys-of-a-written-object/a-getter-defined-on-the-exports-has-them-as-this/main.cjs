const names = (exports.listed = ["one", "two"]);
Object.defineProperty(exports, "grow", { get() { return this.listed.push("extra"); } });
exports.grow;
for (const name of names) console.log("SAID", name, require(`./${name}.cjs`).name);
