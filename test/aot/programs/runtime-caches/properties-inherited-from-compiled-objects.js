// Properties that are inherited from an object literal or from an instance that serves as a prototype. Each round reads them often enough to fill the caches,
// and between the rounds the holder changes in every way an object can: readers see each change, and a store below the holder shadows it or is refused.
function attempt(run) { try { return String(run()); } catch (e) { return e.name; } }

function Animal(name) { this.name = name; }
Animal.prototype = {
  constructor: Animal,
  kind: "animal",
  legs: 4,
  visits: 0,
  speak() { return this.name + " speaks"; },
};

function Dog(name) { Animal.call(this, name); this.tricks = 0; }
Dog.prototype = new Animal("nobody");
Dog.prototype.constructor = Dog;
Dog.prototype.fetch = function () { return this.name + " fetches"; };

// What a proxy has seen is out of the compiler's sight, so these objects are read and stored by name.
const outOfSight = new Proxy({}, {});
outOfSight.value = Animal;
outOfSight.value = Dog;

const cat = new Animal("cat");
const rex = new Dog("rex");
const names = ["kind", "legs", "visits", "name", "tricks"];

function readAll(animal) {
  let text = "";
  for (const name of names) text += animal[name] + ",";
  return text + animal.legs + "," + animal.kind + "," + animal.speak() + "," + ("legs" in animal) + "," + Object.hasOwn(animal, "legs");
}

function round(label) {
  let last = "";
  for (let i = 0; i < 12; i++) last = readAll(cat) + " / " + readAll(rex) + " / " + rex.fetch();
  console.log(label + ": " + last);
}

round("start");
Animal.prototype.legs = 6;
round("another value");
Animal.prototype.legs = "many";
round("a value of another type");
Animal.prototype.speak = function () { return this.name + " shouts"; };
round("another method");
cat.legs = 3;
round("shadowed in one object");
delete cat.legs;
round("shadow deleted");
Dog.prototype.legs = 5;
round("shadowed in the middle of the chain");
delete Dog.prototype.legs;
round("middle shadow deleted");
delete Animal.prototype.legs;
round("deleted");
Animal.prototype.legs = 8;
round("created again");
for (let i = 0; i < 12; i++) { cat.visits++; rex.visits += 2; }
round("counted up from the inherited value");
console.log(Animal.prototype.visits, Dog.prototype.visits, Object.keys(cat).join(), Object.keys(rex).join());

let reads = 0;
Object.defineProperty(Animal.prototype, "legs", { get() { reads++; return 10; }, set(value) { this.stored = value; }, configurable: true, enumerable: true });
round("an accessor");
console.log(reads > 0, attempt(() => { rex.legs = 1; return rex.stored + " " + Object.hasOwn(rex, "legs"); }));
Object.defineProperty(Animal.prototype, "legs", { value: 12, writable: false, configurable: true, enumerable: true });
round("read-only");
console.log(attempt(() => { new Dog("a").legs = 1; return "stored"; }), attempt(() => Reflect.set(new Dog("b"), "legs", 1)));
Object.defineProperty(Animal.prototype, "legs", { value: 14, writable: true, configurable: true, enumerable: true });
round("writable again");
console.log(attempt(() => { const dog = new Dog("c"); dog.legs = 1; return dog.legs + " " + Object.hasOwn(dog, "legs"); }));

Object.setPrototypeOf(Dog.prototype, { kind: "other", legs: 16, speak() { return this.name + " whispers"; } });
round("another parent");
Object.setPrototypeOf(Dog.prototype, Animal.prototype);
round("the first parent again");

Object.freeze(Animal.prototype);
round("frozen");
console.log(attempt(() => { new Dog("d").kind = "x"; return "stored"; }), attempt(() => { Animal.prototype.kind = "x"; return "stored"; }), attempt(() => { const dog = new Dog("e"); return dog.name + " " + dog.tricks; }));

function Late(name) { this.name = name; this.kind = "late"; }
Late.prototype = Object.create(Dog.prototype);
console.log(attempt(() => new Late("f").kind));
