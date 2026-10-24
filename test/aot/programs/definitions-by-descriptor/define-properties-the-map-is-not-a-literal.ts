// Nobody knows the names: every reader of every name may meet either getter.
function Box(this: any) { this.inside = 5; }
const map: PropertyDescriptorMap = {};
for (const [index, name] of ["al" + "pha", "be" + "ta"].entries()) map[name] = { get(this: any) { return this.inside + index; } };
Object.defineProperties(Box.prototype, map);
const box = new (Box as any)();
console.log(box.alpha * 10 + box.beta);
