// A constructor function stores, on some objects, an own function under the name of a method of its prototype.
function Base(special) { this.total = 0; if (special) this.step = function () { return 100; }; }
Base.prototype.step = function () { this.total += 1; return this.total; };
var count = Number(process.env.COUNT || 1000), plain = new Base(false), odd = new Base(true), sum = 0;
for (var i = 0; i < count; i++) sum = (sum + plain.step() + (i & 1023 ? 0 : odd.step())) | 0;
console.log(sum, odd.step(), Object.keys(plain).join(), Object.keys(odd).join());
