// `object.constructor` is asked of the run time once for each shape of receiver, and the prototype of the class need not make its members for that. What was learnt ends when the property is replaced.
// Only the jsc shell can count. Elsewhere the program checks the answers alone.
// Env: JSC_aotCountsPath=/dev/null
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
class Animal { legs = 4; speak() { return "..."; } walk() { return this.legs; } sleep() { return "zzz"; } eat() { return "yum"; } }
class Dog extends Animal { name = "rex"; speak() { return "woof"; } }
class Puppy extends Dog { age = 1; }
function makers(value, turns) { let maker; for (let i = 0; i < turns; i++) maker = value.constructor; return maker; }
function kinds(value, turns) { let text = ""; for (let i = 0; i < turns; i++) text = value.constructor.name; return text; }
function copies(value, turns) { let copy; for (let i = 0; i < turns; i++) copy = new value.constructor(); return copy; }
const asked = () => count("operationAOTGetByIdAndCache");
const receivers = [new Animal(), new Dog(), new Puppy()];
let most = 0;
const results = [];
for (const receiver of receivers) {
  const before = asked();
  results.push(makers(receiver, 500).name);
  most = Math.max(most, asked() - before);
}
console.log(results.join());
console.log(most <= 3 ? "the constructor was not asked of the run time more than three times" : "the run time was asked " + most + " times for the constructor of one class");
const [animal, dog, puppy] = receivers;
console.log(makers(animal, 5) === Animal, makers(dog, 5) === Dog, makers(puppy, 5) === Puppy, kinds(puppy, 5), copies(puppy, 5) instanceof Puppy, copies(dog, 5).speak());
console.log(Object.getOwnPropertyDescriptor(Dog.prototype, "constructor").enumerable, Object.keys(dog).join(), makers(dog, 5) === Dog);
Puppy.prototype.constructor = Animal;
console.log(kinds(animal, 5), kinds(dog, 5), kinds(puppy, 5), copies(puppy, 5) instanceof Puppy);
delete Puppy.prototype.constructor;
console.log(kinds(puppy, 5));
delete Dog.prototype.constructor;
console.log(kinds(dog, 5), kinds(puppy, 5));
puppy.constructor = Dog;
console.log(kinds(puppy, 5), kinds(new Puppy(), 5));
class Odd { ["constructor"]() { return "a method"; } other() { return 1; } }
function calls(value, turns) { let text = ""; for (let i = 0; i < turns; i++) text = value.constructor(); return text; }
console.log(calls(new Odd(), 100), new Odd().other());
if (typeof gc === "function") gc(); else if (typeof Bun !== "undefined") Bun.gc(true);
console.log(kinds(new Animal(), 100), kinds(new Dog(), 100));
