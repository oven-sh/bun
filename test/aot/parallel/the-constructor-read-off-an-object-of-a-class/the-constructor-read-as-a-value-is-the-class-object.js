// constructor read as a value is the class object itself: compared, its static field and its prototype read.
// STATISTIC: ConstructorsReadOffObjectsOfClasses >= 1
class Base { static tag = "base"; again() { return new this.constructor(); } told() { const made = this.constructor; return made.tag + (made === Heir) + (made === Base) + (made.prototype === Object.getPrototypeOf(this)); } }
class Heir extends Base { static tag = "heir"; }
let out = "";
const both = [new Base(), new Heir()];
for (let turn = 0; turn < 300; turn++) { const one = both[turn % 2].again(); out = one.told() + " " + (one instanceof Heir) + " " + out.slice(0, 24); }
console.log(out);
