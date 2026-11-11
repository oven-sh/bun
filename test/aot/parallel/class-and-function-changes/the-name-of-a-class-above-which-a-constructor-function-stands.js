// Under: --aot-testing=CheckProofsAtRunTime: what is proven of the instances is asked again at run time
// `name` and `length` are the class object's own, whatever stands above the class: a constructor function, one with a `name` of its own laid on it, an accessor above, a class with a static of that name.
"use strict";
function tryTo(deed) {
  try { return deed(); } catch (error) { return error.name; }
}
function Base(from) { this.from = from; }
Base.prototype.greet = function () { return this.from + " " + this.own; };
Object.defineProperty(Base, "label", { get() { return "label of " + this.name; } });
var Renamed = class Inner extends Base {
  constructor() { super("base"); this.own = "own"; }
};
console.log(Renamed.name, Renamed.length, Renamed.label);
Object.defineProperty(Renamed, "name", { value: "Outer" });
Object.defineProperty(Renamed, "length", { value: 3 });
const made = new Renamed();
console.log(made.greet(), Renamed.name, Renamed.length, Renamed.label, Base.name, made.constructor.name);
console.log(tryTo(() => { Renamed.name = "by a store"; }), Renamed.name);
class Below extends Renamed {}
console.log(Below.name, Below.length, new Below().greet(), Below.label);
Object.defineProperty(Below, "name", { value: { not: "a text" } });
console.log(Below.name.not, Renamed.name);
console.log(delete Below.name, Below.name, delete Renamed.name, Below.name, Renamed.name);

function Named() {}
Object.defineProperty(Named, "name", { get() { return "by a getter above"; } });
class UnderGetter extends Named {}
console.log(UnderGetter.name);
Object.defineProperty(UnderGetter, "name", { value: "its own" });
console.log(UnderGetter.name, delete UnderGetter.name, UnderGetter.name);

class WithStatic extends Base { static name() { return "a static method"; } }
console.log(typeof WithStatic.name);
Object.defineProperty(WithStatic, "name", { value: "laid over the method" });
console.log(WithStatic.name);
const key = process.argv.length > 99 ? "other" : "name";
class Keyed extends Base { static get [key]() { return "a getter under a computed key"; } }
console.log(Keyed.name, tryTo(() => { Keyed.name = 1; }));
Object.defineProperty(Keyed, "name", { value: "laid over the getter" });
console.log(Keyed.name);
