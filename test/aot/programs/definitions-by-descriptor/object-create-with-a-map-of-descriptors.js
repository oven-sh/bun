// Object.create with a map of descriptors: the old way to inherit, an object with accessors, a map that is no literal, attributes, and getters in the map and in a descriptor.
function Animal(name) { this.name = name; }
Animal.prototype.speak = function () { return this.name + " makes a sound"; };
function Dog(name) { Animal.call(this, name); }
Dog.prototype = Object.create(Animal.prototype, {
  constructor: { value: Dog, enumerable: false, writable: true, configurable: true },
  bark: { value() { return this.name + " barks"; } },
});
const dog = new Dog("Rex");
console.log(dog.speak(), dog.bark(), dog.constructor === Dog, dog instanceof Animal, Object.keys(Dog.prototype).length);

let reads = 0;
const meter = Object.create(null, {
  level: { value: 3, writable: true, enumerable: true },
  doubled: { get() { reads++; return this.level * 2; }, enumerable: false },
  fixed: { value: "fixed" },
});
meter.level = 5;
try { "use strict"; meter.fixed = "changed"; } catch { console.log("threw"); }
console.log(meter.level, meter.doubled, reads, meter.fixed, Object.keys(meter).join(), "toString" in meter);

const map = {};
for (const name of ["al" + "pha", "be" + "ta"]) map[name] = { value: name.length, enumerable: true };
const computed = Object.create({ inherited: 1 }, map);
console.log(computed.alpha, computed.beta, computed.inherited, JSON.stringify(computed));

const order = [];
const watched = Object.create({}, {
  get first() { order.push("first"); return { value: 1 }; },
  second: { get value() { order.push("value of second"); return 2; } },
});
console.log(watched.first, watched.second, order.join());

class Item { constructor(size) { this.size = size; } double() { return this.size * 2; } }
const holder = Object.create(null, { item: { value: new Item(4) } });
console.log(holder.item.double());
try { Object.create({}, { broken: 1 }); } catch (error) { console.log(error instanceof TypeError); }
console.log(Object.getOwnPropertyNames(Object.create({}, undefined)).length);
