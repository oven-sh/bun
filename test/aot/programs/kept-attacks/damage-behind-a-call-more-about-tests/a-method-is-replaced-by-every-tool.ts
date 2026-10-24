// The holder calls a method, reads a getter of the class and walks the object with for-of, makes a call, and does all three again. Below the call one of the three members is replaced, hidden or taken away,
// each time by another tool than a plain assignment to the prototype object: Object.assign, defineProperty and defineProperties, Reflect, a proxy without traps around the prototype object,
// a new parent for it, an own property of the instance, a class field defined on the instance.
class Base {
  label(): string {
    return "base";
  }
}
class Bag extends Base {
  size: number;
  constructor(size: number) {
    super();
    this.size = size;
  }
  twice(): number {
    return this.size * 2;
  }
  get half(): number {
    return this.size / 2;
  }
  *[Symbol.iterator](): Generator<number> {
    yield this.size;
    yield this.size + 1;
  }
}

const own = Object.getOwnPropertyDescriptors(Bag.prototype);
function repair(): void {
  for (const name of Reflect.ownKeys(Bag.prototype)) if (!(name in own)) delete (Bag.prototype as any)[name];
  Object.defineProperties(Bag.prototype, own);
  Object.setPrototypeOf(Bag.prototype, Base.prototype);
}

const handsBack = function (this: any, o: any): any {
  return o;
} as any;
class Stamp extends handsBack {
  twice = () => -11;
}

const ways: ((bag: any) => void)[] = [
  () => void Object.assign(Bag.prototype, { twice: () => -1 }),
  () => void Object.defineProperty(Bag.prototype, "twice", { value: () => -2, configurable: true, writable: true }),
  () => void Object.defineProperties(Bag.prototype, { half: { get: () => -3, configurable: true } }),
  () => void Reflect.set(Bag.prototype, "twice", () => -4),
  () => void Reflect.defineProperty(Bag.prototype, "half", { value: -5, configurable: true }),
  () => void Reflect.deleteProperty(Bag.prototype, "twice"),
  () => void (new Proxy(Bag.prototype, {}).twice = () => -6),
  () => void delete (new Proxy(Bag.prototype, {}) as any).half,
  () => void Object.setPrototypeOf(Bag.prototype, { label: () => "another parent" }),
  () => void ((Bag.prototype as any).__proto__ = { label: () => "__proto__" }),
  () => void ((Bag.prototype as any).label = () => "in front"),
  () => void ((Bag.prototype as any)[Symbol.iterator] = function* () { yield -7; }),
  () => void Reflect.deleteProperty(Base.prototype, "label"),
  bag => void Object.defineProperty(bag, "twice", { value: () => -8, configurable: true }),
  bag => void Object.defineProperty(bag, "half", { get: () => -9, configurable: true }),
  bag => void (bag[Symbol.iterator] = function* () { yield -10; }),
  bag => void new (Stamp as any)(bag),
  bag => void Object.assign(bag, { label: () => "own" }),
];
const labelOfBase = Base.prototype.label;

let way = -1;
function touch(bag: Bag): number {
  if (way >= 0) ways[way](bag);
  return 1;
}

function holder(bag: Bag): string {
  let before = bag.twice() + "," + bag.half + "," + bag.label();
  for (const value of bag) before += "," + value;
  const got = touch(bag);
  let twice: string;
  try {
    twice = "" + bag.twice();
  } catch (error) {
    twice = (error as Error).name;
  }
  let label: string;
  try {
    label = bag.label();
  } catch (error) {
    label = (error as Error).name;
  }
  let after = twice + "," + bag.half + "," + label;
  for (const value of bag) after += "," + value;
  return before + " " + got + " " + after;
}

for (let round = 0; round < 50 * ways.length; round++) {
  way = round % 50 === 49 ? (round - 49) / 50 : -1;
  const line = holder(new Bag(round));
  if (way >= 0) {
    repair();
    Base.prototype.label = labelOfBase;
  }
  if (way >= 0 || round === 0) console.log(round + ": " + line);
}
