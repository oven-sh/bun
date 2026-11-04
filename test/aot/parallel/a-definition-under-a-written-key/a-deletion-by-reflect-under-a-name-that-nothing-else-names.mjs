const o = { a: 1 };
const suffix = Date.now() > 0 ? "Name" : "";
o["hidden" + suffix] = 2;
function act() { return Reflect.deleteProperty(o, "hiddenName"); }
console.log(act(), Object.keys(o).join());
