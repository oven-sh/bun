// `this` leaves while the object is half made: from the constructor above, from a field initializer, from a method that the class below overrides.
const lines = [];
const seen = [];
class Base { constructor() { seen.push(Object.keys(this).join("") + "|" + this.describe()); } first = "f"; describe() { return "base"; } }
const Mixin = (Parent) => class extends Parent { second = (seen.push(Object.keys(this).join("")), "s"); #hidden = "h"; describe() { try { return "mixin" + this.#hidden; } catch (error) { return "early:" + error.constructor.name; } } third = this.describe(); };
class A extends Mixin(Base) { fourth = "4"; describe() { return "a>" + super.describe() + (this.fourth || "-"); } }
for (let i = 0; i < 3; i++) { const a = new A(); lines.push(Object.keys(a).join(""), a.third, a.describe()); }
lines.push(seen.join(" "));
let kept = []; class Keeper { constructor() { kept.push(this); } }
class K extends Mixin(Keeper) { tail = 1; }
let sum = 0; for (let i = 0; i < 200; i++) { const k = new K(); sum += kept[i] === k ? k.tail : 100; } lines.push(sum, kept.length, kept[7].describe());
console.log(lines.join(" "));
