const names = (exports.listed = ["one", "two"]);
class Walk { go() { return this.step(); } step() { return 1; } }
new Walk().go();
for (const name of names) console.log("SAID", name, require(`./${name}.cjs`).name);
