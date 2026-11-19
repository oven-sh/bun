// A bound function prints the name that the function it calls was declared with. A function that has its name from where it stands
// (const f = () => {}) was declared without one; once the bound function's own name has been read, that name is printed.
const arrow = x => x;
const expression = function () {};
const named = function declared() {};
const anonymousClass = class {};
class Declared {
  static field = () => 1;
  static method() {}
  own = () => 2;
  get getter() { return () => 3; }
}
function declaration() {}
async function asynchronous() {}
function* generator() {}
const object = { method() {}, property: () => 1, "two words"() {}, 7: () => 1, 8() {} };
const assigned = { later: null };
assigned.later = function () {};
const { byDefault = () => 1 } = {};
function Constructor() { this.arrow = () => 1; }

console.log(arrow.bind(), expression.bind(), named.bind(), anonymousClass.bind(), Declared.bind());
console.log(Declared.field.bind(), Declared.method.bind(), new Declared().own.bind(), new Declared().getter.bind());
console.log(declaration.bind(), asynchronous.bind(), generator.bind());
console.log(object.method.bind(), object.property.bind(), object["two words"].bind(), object[7].bind(), object[8].bind());
console.log(assigned.later.bind(), byDefault.bind(), new Constructor().arrow.bind());
console.log([arrow.bind()], { bound: arrow.bind() }, arrow.bind().bind(), declaration.bind().bind());
const bound = arrow.bind();
console.log(bound, bound.name, bound, arrow, arrow.name);
console.log(String(arrow.bind()), Array.prototype.map.bind([]), parseInt.bind());
