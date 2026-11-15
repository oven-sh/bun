const names = (exports.listed = ["one", "two"]);
class Reach { me() { return this; } } Object.defineProperty(exports, "self", { get: Reach.prototype.me }); exports.self.listed.push("extra");
for (const name of names) console.log("SAID", name, require(`./${name}.cjs`).name);
