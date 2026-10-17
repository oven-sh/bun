// new.target in a function that a class extends is what the class was constructed with, also where that is a small function handed to Reflect.construct.
const other = function Other() {};
function nameOf(v) { return v === undefined ? "undefined" : v.name; }
let seen;
function UsesArguments() { void arguments.length; seen = new.target; }
function UsesRest(...all) { void all.length; seen = new.target; }
function UsesNeither() { seen = new.target; }
function UsesArgumentsStrict() { "use strict"; void arguments[0]; seen = new.target; }
class A extends UsesArguments { constructor() { super(1); } }
class B extends UsesRest { constructor() { super(1); } }
class C extends UsesNeither { constructor() { super(1); } }
class D extends UsesArgumentsStrict { constructor() { super(1); } }
class E extends UsesArguments {}
for (const K of [A, B, C, D, E]) {
  const line = [K.name];
  seen = "unset"; new K(); line.push("new: " + nameOf(seen));
  seen = "unset"; Reflect.construct(K, [], other); line.push("Reflect.construct: " + nameOf(seen));
  console.log(line.join(" | "));
}
for (const F of [UsesArguments, UsesRest, UsesNeither, UsesArgumentsStrict]) {
  const line = [F.name];
  seen = "unset"; new F(1); line.push("new: " + nameOf(seen));
  seen = "unset"; Reflect.construct(F, [1], other); line.push("Reflect.construct: " + nameOf(seen));
  seen = "unset"; F(1); line.push("call: " + nameOf(seen));
  console.log(line.join(" | "));
}
function ReturnsIt() { return { target: new.target }; }
class F extends ReturnsIt { constructor() { super(); } }
const arrowless = [function First() {}, function Second() {}, class Third {}, Object, F];
for (let round = 0; round < 3; round++) console.log(arrowless.map(target => nameOf(Reflect.construct(F, [], target).target)).join());
function Guarded() { if (!new.target) return new Guarded(); this.made = nameOf(new.target); }
class G extends Guarded {}
console.log(Reflect.construct(G, [], other).made, new G().made, Guarded().made, Object.getPrototypeOf(Reflect.construct(G, [], other)) === other.prototype);
