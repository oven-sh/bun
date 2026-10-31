// `.constructor` of an object of one of several classes: behind the tests of its class it is one class object, unless something changes the class or its prototype.
class Alpha {}
class Beta {}
class Gamma extends Alpha {}
const values = [new Alpha(), new Beta(), new Gamma()];
function nameOf(i: number) {
  return values[i % 3]!.constructor.name;
}
let text = "";
for (let i = 0; i < 300; i++) text = nameOf(i);
console.log(text, nameOf(0), nameOf(1), nameOf(2));

class Own {
  constructor() {
    (this as any).constructor = "own";
  }
}
class Plain {}
const mixed: object[] = [new Own(), new Plain()];
function readMixed(i: number) {
  return mixed[i & 1]!.constructor;
}
for (let i = 0; i < 300; i++) readMixed(i);
console.log(readMixed(0), readMixed(1) === Plain);

class Changed {}
class Stays {}
const changing = [new Changed(), new Stays()];
function readChanging(i: number) {
  return changing[i & 1]!.constructor;
}
for (let i = 0; i < 300; i++) readChanging(i);
console.log(readChanging(0) === Changed);
(Changed.prototype as any).constructor = Stays;
console.log(readChanging(0) === Stays, readChanging(1) === Stays);

class Relinked {}
class Other {}
const relinked = [new Relinked(), new Other()];
function readRelinked(i: number) {
  return relinked[i & 1]!.constructor;
}
for (let i = 0; i < 300; i++) readRelinked(i);
Object.setPrototypeOf(relinked[0], Other.prototype);
console.log(readRelinked(0) === Other);

function Old(this: any) {}
function Older(this: any) {}
const fromFunctions = [new (Old as any)(), new (Older as any)()];
function readFunctions(i: number) {
  return fromFunctions[i & 1]!.constructor;
}
for (let i = 0; i < 300; i++) readFunctions(i);
console.log(readFunctions(0) === Old, readFunctions(1) === Older);

function Made() {
  return class Inner {};
}
const First = Made();
const Second = Made();
const madeTwice = [new First(), new Second()];
function readMade(i: number) {
  return madeTwice[i & 1]!.constructor;
}
for (let i = 0; i < 300; i++) readMade(i);
console.log(readMade(0) === First, readMade(1) === Second, readMade(0) === Second);
