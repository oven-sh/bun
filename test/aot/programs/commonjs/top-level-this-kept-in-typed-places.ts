// The top-level `this` of a TypeScript file that runs as CommonJS is its `module.exports`: an object literal, an array, a parameter, a field and a direct eval's scope take it without a TypeError.
let local: number = 1;
const holder = { self: this };
const list = [this];
function kindOf(value: unknown): string { return typeof value; }
class Keeper { kept: unknown = undefined; }
const keeper = new Keeper();
keeper.kept = this;
console.log(typeof this, typeof holder.self, holder.self === module.exports, typeof list[0], kindOf(this), keeper.kept === module.exports);
console.log(eval("local + 1"), eval("typeof this"));
eval("local = 5");
const inArrow = () => eval("typeof this + local");
console.log(local, inArrow());
