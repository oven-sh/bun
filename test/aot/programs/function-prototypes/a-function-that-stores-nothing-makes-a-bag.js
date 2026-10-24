// `const NullObject = function () {}; NullObject.prototype = Object.create(null)`: a constructor function that stores nothing, whose objects are filled by whoever made them, as a router fills the
// parameters of a route. The objects are made by compiled code, by text compiled at run time, by Reflect.construct and below a class, and are asked for all that tells one kind of object from another.
const NullObject = function () {};
NullObject.prototype = Object.create(null);

function Plain() {}
function WithMethod() {}
WithMethod.prototype.size = function () { return Object.keys(this).length; };
function WithField() { this.first = 1; }
class Below extends Plain { constructor() { super(); this.own = "own"; } }
class EmptyClass { size() { return Object.keys(this).length; } }

const fillAtRunTime = new Function("Bag", "values", "const bag = new Bag(); bag['shop'] = values[0]; bag.order = values[1]; return bag;");
function fillHere(Bag, values) { const bag = new Bag(); bag.shop = values[0]; bag["order"] = values[1]; return bag; }
const handedBack = value => new CustomEvent("handed back", { detail: value }).detail;

function show(label, bag) {
  const prototype = Object.getPrototypeOf(bag);
  console.log(label, JSON.stringify(bag), Object.keys(bag).join(), "shop" in bag, "toString" in bag, prototype === null ? "null" : Object.getPrototypeOf(prototype) === null ? "one above" : "more above",
    Object.getOwnPropertyNames(bag).length, Object.isExtensible(bag), bag.shop, bag.missing);
}

for (const Bag of [NullObject, Plain, WithMethod, WithField, Below, EmptyClass].map(handedBack)) {
  for (let round = 0; round < 3; round++) {
    const a = fillAtRunTime(Bag, ["west", round]);
    const b = fillHere(Bag, ["east", round]);
    if (round !== 2) continue;
    show(Bag.name + " at run time", a);
    show(Bag.name + " here", b);
    console.log(a instanceof Bag, b instanceof Bag, a.constructor === Bag, typeof a.size === "function" ? a.size() : "no size");
    delete a.shop; a.late = 1; Object.defineProperty(b, "hidden", { value: 2, enumerable: false });
    show(Bag.name + " changed", a);
    show(Bag.name + " defined", b);
    Object.freeze(b);
    try { "use strict"; b.more = 1; } catch (error) { console.log(error.constructor.name); }
    console.log(Object.isFrozen(b), b.more, b.hidden);
  }
}

const constructed = Reflect.construct(NullObject, [], Plain);
constructed.shop = "north";
show("Reflect.construct", constructed);
console.log(constructed instanceof Plain, Object.getPrototypeOf(constructed) === Plain.prototype);

NullObject.prototype = { inherited: "yes" };
const later = fillAtRunTime(NullObject, ["south", 9]);
console.log(later.inherited, Object.keys(later).join(), later instanceof NullObject);

let sum = 0;
for (let i = 0; i < 20000; i++) { const bag = fillAtRunTime(Plain, [i, i + 1]); sum = (sum + bag.shop + bag.order + fillHere(Plain, [i, 1]).shop) | 0; }
console.log(sum);
