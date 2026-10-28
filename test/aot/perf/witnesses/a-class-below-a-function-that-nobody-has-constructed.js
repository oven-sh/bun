// A class extends a constructor function that nobody has constructed when the class is defined, as the classes of node:stream's users do (nobody constructs a Duplex).
// The function got its class, and its prototype object a place in the class table, only at its first construction. So the guards of the class on what it inherits found
// nothing above it, were never set, and stood in the way of every site that an instance of the class may reach: each call of an inherited method tested, failed and went by name.
function Counter() { this.count = 0; }
Counter.prototype.add = function (by) { this.count += by; return this.count; };
Counter.prototype.read = function () { return this.count; };
class Doubling extends Counter {
  twice(by) { return this.add(by) + this.add(by); }
}
class Tripling extends Counter {
  thrice(by) { return this.add(by) + this.add(by) + this.add(by); }
}
// What native code hands back is unknown to the compiler.
const handedBack = value => new CustomEvent("handed back", { detail: value }).detail;
const counters = [handedBack(new Doubling()), handedBack(new Tripling())];
function bump(counter, by) { return counter.add(by) + counter.read(); }

let sum = 0;
for (let i = 0; i < 2_000_000; i++) sum = (sum + bump(counters[i & 1], i & 7)) | 0;
console.log(sum, counters[0].twice(1), counters[1].thrice(1));
