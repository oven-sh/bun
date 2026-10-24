// A small random number generator with a fixed seed chooses 12000 operations on eight instances of a derived class, on its prototype and on the prototype of its base:
// typed reads, first stores and deletes of three optional fields, and values, getters, setters and read-only members that come and go under the same names one and two levels up,
// single instances that change their prototype, get undeclared properties or are closed. After every operation the typed view of all eight instances goes into a checksum.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
class Base {
  declare id: number;
  declare a?: number;
  constructor(id: number) {
    this.id = id;
    handOver(this);
  }
}
class Derived extends Base {
  declare b?: number;
  c?: number;
}
let setterCalls = 0;
function view(object: Derived) {
  return `${object.a},${object.b},${object.c},${"a" in object}${"b" in object}${"c" in object},${Object.keys(object)}`;
}
function setA(object: Derived, value: number) { object.a = value; }
function setB(object: Derived, value: number) { object.b = value; }
function setC(object: Derived, value: number) { object.c = value; }
function dropA(object: Derived) { delete object.a; }
function dropB(object: Derived) { delete object.b; }
function dropC(object: Derived) { delete object.c; }
function orA(object: Derived) { return (object.a ??= 7); }
function bumpB(object: Derived) { object.b = (object.b ?? 0) + 1; }
let seed = Number(process.argv[2] ?? 2024);
function random(below: number) {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return Math.floor((seed / 2147483648) * below);
}
function hash(text: string, into: number) {
  for (let i = 0; i < text.length; i++) into = (Math.imul(into, 31) + text.charCodeAt(i)) | 0;
  return into;
}
const names = ["a", "b", "c"];
const holders: object[] = [Derived.prototype, Base.prototype];
const descriptors: (() => PropertyDescriptor)[] = [
  () => ({ value: random(50), writable: true, enumerable: random(2) === 0, configurable: true }),
  () => ({ value: random(50), writable: false, enumerable: false, configurable: true }),
  () => ({ get() { return 60; }, configurable: true }),
  () => ({ set(value: number) { setterCalls += value; }, configurable: true }),
  () => ({ get() { return undefined; }, set(value: number) { setterCalls += value; }, enumerable: true, configurable: true }),
];
let objects: Derived[] = [];
for (let i = 0; i < 8; i++) objects.push(new Derived(i));
let warm = 0;
for (let i = 0; i < 3000; i++) {
  const object = new Derived(i);
  warm += view(object).length;
  setA(object, 1);
  bumpB(object);
  dropC(object);
  warm += orA(object) + view(object).length;
}
console.log("warm", warm);
function step() {
  const index = random(8);
  const object = objects[index];
  const name = names[random(3)];
  switch (random(20)) {
    case 0: return setA(object, random(9));
    case 1: return setB(object, random(9));
    case 2: return setC(object, random(9));
    case 3: return dropA(object);
    case 4: return dropB(object);
    case 5: return dropC(object);
    case 6: return void orA(object);
    case 7: return bumpB(object);
    case 8:
    case 9:
    case 10: return void Object.defineProperty(holders[random(2)], name, descriptors[random(descriptors.length)]());
    case 11:
    case 12:
    case 13:
    case 14: return void delete (holders[random(2)] as any)[name];
    case 15: return void ((object as any)["x" + random(2)] = 1);
    case 16: return void Object.setPrototypeOf(object, random(2) ? Derived.prototype : random(2) ? Base.prototype : { [name]: 90 });
    case 17: return void (random(8) === 0 && Object.preventExtensions(object));
    case 18: return void ((holders[random(2)] as any)[name] = random(50));
    default: return void (objects[index] = new Derived(index));
  }
}
let checksum = 0;
let refused = 0;
for (let round = 0; round < 12000; round++) {
  try {
    step();
  } catch {
    refused++;
  }
  for (const object of objects) checksum = hash(view(object), checksum);
  if (round % 1000 === 999) console.log(round, checksum, refused, setterCalls, view(objects[round % 8]));
}
