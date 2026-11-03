// A module exports the namespace objects of other modules again, and this file reads them off what require() answers. Nothing else names those modules, and each object shows all that its module exports.
var listed = require("./again.mjs").listed;
console.log(listed.c, Object.keys(listed));

function show(object) {
  return [object.d, Object.keys(object)];
}
console.log(show(require("./again.mjs").handedOver));

const spread = require("./again.mjs").spread;
console.log({ ...spread });

console.log(JSON.stringify(require("./again.mjs")["written"]));

const again = require("./again.mjs");
for (const name in again.walked) console.log(name);

console.log(Reflect.deleteProperty(again.asked, "c"), Reflect.has(again.asked, "d"), Reflect.deleteProperty(again.asked, "e"));

const key = ["c", "d"][process.argv.length > 99 ? 0 : 1];
console.log(again.keyed[key]);

const box = { held: again.renamed };
console.log(Object.entries(box.held));

console.log(Object.entries(require("./again.mjs").farther));

console.log(Object.values(again.outer.inside));

console.log(Object.keys(again.whole), Object.keys(require("./again.mjs").face));

console.log(again.readByName.c);
