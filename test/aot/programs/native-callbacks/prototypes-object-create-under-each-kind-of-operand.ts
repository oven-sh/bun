// What Object.create makes lies under its operand alone, whatever the operand is, and a later change above the operand shows through it.
class Animal {
  legs = 4;
  speak(): string {
    return "legs " + (this as any).legs;
  }
}

function make(prototype: any): any {
  return Object.create(prototype);
}

const bare = make(null);
console.log(typeof bare.toString, typeof bare.hasOwnProperty, "toString" in bare);
try {
  console.log(`${bare}`);
} catch (error) {
  console.log((error as Error).constructor === TypeError);
}

const heir = make(Animal.prototype);
heir.legs = 2;
console.log(heir.speak(), heir instanceof Animal, typeof heir.toString);

const base: any = make(null);
base.greet = function () { return "hello " + this.name; };
const below = make(base);
below.name = "below";
console.log(below.greet(), typeof below.toString);
Object.setPrototypeOf(base, Animal.prototype);
console.log(below.speak(), typeof below.toString);

const underFunction = make(function callee() {});
console.log(typeof underFunction.call, typeof underFunction, underFunction.name);
const underArray = make([1, 2, 3]);
console.log(underArray.length, underArray[1], Array.isArray(underArray), underArray.join("-"));
const underProxy = make(new Proxy({}, { get: (_, name) => "trap " + String(name) }));
console.log(underProxy.anything, underProxy.toString);
for (const wrong of [undefined, 1, "text"]) {
  try {
    make(wrong);
  } catch (error) {
    console.log((error as Error).constructor === TypeError);
  }
}
const described = Object.create(null, { shown: { value: 1, enumerable: true }, hidden: { value: 2 } });
console.log(described.shown, described.hidden, Object.keys(described).join(), typeof described.toString);
