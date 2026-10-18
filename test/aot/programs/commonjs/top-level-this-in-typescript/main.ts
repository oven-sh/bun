// The top-level `this` of a TypeScript file that runs as CommonJS is its `module.exports`, though TypeScript says `undefined`. It is kept in typed places and handed to a direct eval without a TypeError.
let local: number = 1;
try { console.log(eval("1 + 1")) } catch (e) { console.log(String(e)) }; console.log(typeof require("./helper.cjs").join)
console.log("main.ts", eval("local + 1"));
eval("local = 5");
console.log(local, typeof this, this === module.exports, eval("typeof this"));
const holder = { self: this };
const list = [this];
function kindOf(value: unknown): string { return typeof value; }
class Keeper { kept = this; static first = this; }
console.log(typeof holder.self, holder.self === module.exports, typeof list[0], kindOf(this), typeof new Keeper().kept, Keeper.first === Keeper);
const inArrow = () => eval("typeof this + local");
function inFunction(this: unknown) { return eval("typeof this + local"); }
console.log(inArrow(), inFunction());
require("./exports-only.ts");
require("./this-only.ts");
require("./without-signs.ts");
require("./commonjs.cts");
require("./module.mts");
require("./javascript.js");
require("./javascript.cjs");
