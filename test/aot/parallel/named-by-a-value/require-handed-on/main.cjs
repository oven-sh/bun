// Entry points: ./modules/a.cjs ./modules/b.cjs
const which = globalThis.never ? "a" : "b";
function load(loader, name) { return loader(name); }
const found = load(require, "./modules/" + which + ".cjs");
console.log(found.run(), new found.Tool().use(), JSON.stringify(new found.Tool(), ["kind"]));
