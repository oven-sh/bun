function Shape() { this.kind = "shape"; }
function Other() {}
function isShape(value) { return value instanceof Shape; }
function isOther(value) { return value instanceof Other; }
function lay(on) { Object.defineProperty(on, Symbol.hasInstance, { value: () => true, configurable: true }); }
const before = [isShape({}), isOther({})].join();
lay(Shape);
const between = [isShape({}), isOther({})].join();
Reflect.defineProperty(Other, Symbol.hasInstance, { value: value => value === 1 });
console.log("SAID", before, between, isShape({}), isOther({}), isOther(1), isOther(new Other()));
