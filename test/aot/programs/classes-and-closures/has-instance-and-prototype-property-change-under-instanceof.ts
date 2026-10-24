// `value instanceof C` in a loop, while text that is evaluated defines Symbol.hasInstance on the class, on its parent and on Function.prototype's heirs, relinks the class objects and the prototype objects, and makes a stranger an instance.
class Animal { legs = 4; }
class Dog extends Animal { name = "dog"; }
class Cat extends Animal { name = "cat"; }
function Plain(this: { kind: string }) { this.kind = "plain"; }

const run = (text: string, ...values: unknown[]) => new Function("Animal", "Dog", "Cat", "Plain", "values", text)(Animal, Dog, Cat, Plain, values);

function count(values: unknown[], change: () => void): string {
  let animals = 0, dogs = 0, cats = 0, plains = 0;
  for (let i = 0; i < 1200; i++) {
    if (i === 600) change();
    const value = values[i % values.length];
    if (value instanceof Animal) animals++;
    if (value instanceof Dog) dogs++;
    if (value instanceof Cat) cats++;
    if (value instanceof (Plain as unknown as new () => object)) plains++;
  }
  return [animals, dogs, cats, plains].join(" ");
}

const stranger = {};
const values: unknown[] = [new Animal(), new Dog(), new Cat(), new (Plain as unknown as new () => object)(), stranger, null, 5, "text", () => 1];
console.log("before", count(values, () => {}));
console.log("a stranger becomes a dog", count(values, () => { run("Object.setPrototypeOf(values[0], Dog.prototype)", stranger); }));
console.log("a dog becomes a cat", count(values, () => { run("Object.setPrototypeOf(values[0], Cat.prototype)", values[1]); }));
console.log("cats stop being animals", count(values, () => { run("Object.setPrototypeOf(Cat.prototype, Object.prototype)"); }));
console.log("the function gets another prototype object", count(values, () => { run("Plain.prototype = Dog.prototype"); }));
console.log("hasInstance on the parent", count(values, () => { run("Object.defineProperty(Animal, Symbol.hasInstance, { value: value => typeof value === 'number', configurable: true })"); }));
console.log("the class object of Dog leaves its parent", count(values, () => { run("Object.setPrototypeOf(Dog, Function.prototype)"); }));
console.log("hasInstance on Cat itself", count(values, () => { run("Object.defineProperty(Cat, Symbol.hasInstance, { value: () => true })"); }));
console.log("hasInstance is removed from the parent", count(values, () => { run("delete Animal[Symbol.hasInstance]"); }));
console.log("after", count(values, () => {}));
