// A field with a decorator is defined on the object like any other field, so it hides an accessor of the base class under the same key.
const key = Symbol("key");
let setterCalls = 0;
function twice(_value: undefined, _context: ClassFieldDecoratorContext) {
  return (initial: number) => initial * 2;
}
class Base {
  get [key](): number {
    return 7;
  }
  set [key](value: number) {
    setterCalls++;
  }
}
class Derived extends Base {
  // @ts-ignore: the field takes the place of the accessor
  @twice [key] = 1;
  read(): number {
    return this[key];
  }
}
const derived = new Derived();
let total = 0;
for (let round = 0; round < 300; round++) total += derived.read();
console.log(total, setterCalls, Object.hasOwn(derived, key));
