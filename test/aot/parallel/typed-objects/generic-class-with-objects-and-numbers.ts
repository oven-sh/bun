// One generic class holds objects in some instances and numbers, strings, functions, arrays or nothing in others. Each instance gives back exactly what was stored in it, whatever the other instances hold, and a generic class beside it that only ever holds objects is not disturbed.
class Item {
  name: string;
  count: number;

  constructor(name: string, count: number) {
    this.name = name;
    this.count = count;
  }
}

class Special extends Item {
  extra = true;
}

class Box<T> {
  value: T;

  constructor(value: T) {
    this.value = value;
  }

  get(): T {
    return this.value;
  }

  replace(value: T): T {
    const previous = this.value;
    this.value = value;
    return previous;
  }

  map<U>(change: (value: T) => U): Box<U> {
    return new Box(change(this.value));
  }
}

class Shelf<T extends Item> {
  top: T;
  below: T | undefined;

  constructor(top: T) {
    this.top = top;
    this.below = undefined;
  }

  push(item: T): void {
    this.below = this.top;
    this.top = item;
  }

  names(): string {
    return this.top.name + "/" + (this.below === undefined ? "-" : this.below.name);
  }
}

function wrap<T>(value: T): Box<T> {
  return new Box(value);
}

function unwrap<T>(box: Box<T>): T {
  return box.value;
}

function pick<A, B>(useFirst: boolean, first: A, second: B): A | B {
  return useFirst ? first : second;
}

function one(): number {
  return 1;
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return "symbol " + value.description;
  if (typeof value === "function") return "function " + value.name;
  if (value instanceof Item) return (value instanceof Special ? "Special " : "Item ") + value.name + " " + value.count;
  if (value instanceof Box) return "Box(" + show(value.value) + ")";
  if (Array.isArray(value)) return "[" + value.map(element => show(element)).join() + "]";
  return String(value);
}

function nameOf(box: Box<Item>): string {
  return box.value.name;
}

function double(box: Box<number>): number {
  return box.value * 2;
}

function shout(box: Box<string>): string {
  return box.value + "!";
}

function call(box: Box<() => number>): number {
  return box.value() + box.get()();
}

function lengthOf(box: Box<number[]>): number {
  return box.value.length;
}

function weigh(box: Box<Item | number>): number {
  const value = box.value;
  return typeof value === "number" ? value : value.count;
}

const item = new Item("item", 3);
const special = new Special("special", 4);
const ofItem = new Box(item);
const ofNumber = new Box(1.5);
const ofString = new Box("text");
const ofFunction = new Box(one);
const ofArray = new Box([1, 2, 3]);
console.log(nameOf(ofItem), double(ofNumber), shout(ofString), call(ofFunction), lengthOf(ofArray));
console.log(nameOf(wrap(item)), double(wrap(-3)), shout(wrap("")), call(wrap(one)), lengthOf(wrap<number[]>([])));

const numbers = [0, -0, 1, -1, 0.5, 2147483647, 2147483648, -2147483648, -2147483649, 4294967296, 1e21, Infinity, -Infinity, NaN];
console.log(numbers.map(n => show(new Box(n).value)).join());
console.log(numbers.map(n => show(wrap(n).get())).join());
console.log(numbers.map(n => show(ofNumber.replace(n))).join(), show(ofNumber.value));
console.log(numbers.map(n => show(double(wrap(n)))).join());

const everything: unknown[] = [item, 7, "seven", special, undefined, null, true, false, 10n, Symbol("s"), one, [item, 1], ofItem, -0];
const boxes: Box<unknown>[] = everything.map(value => wrap(value));
console.log(boxes.map(box => show(unwrap(box))).join(" | "));
console.log(boxes.map(box => show(box.get())).join(" | "));
console.log(boxes.map(box => Object.keys(box).join() + ":" + typeof box.value).join(" "));
console.log(boxes.every((box, index) => Object.is(box.value, everything[index])), boxes.every(box => box instanceof Box));

const reused = new Box<unknown>(item);
console.log(everything.map(value => show(reused.replace(value))).join(" | "), "|", show(reused.value));

const either = new Box<Item | number>(item);
let weight = 0;
for (let i = 0; i < 1000; i++) {
  weight += weigh(either);
  either.value = i % 3 === 0 ? i + 0.5 : i % 3 === 1 ? special : item;
}
console.log(weight, show(either.value), show(either.replace(2 ** 31)), show(either.get()));

console.log(show(ofItem.map(value => value.count)), show(ofItem.map(value => value.count).map(count => "n" + count)));
console.log(show(ofNumber.map(n => new Item("made", n))), show(ofString.map(text => text.length).map(length => new Special("long", length)).map(made => made)));
console.log(nameOf(ofNumber.map(n => new Item("from a number", n))), double(ofItem.map(value => value.count)));

const nested = new Box(new Box(2.5));
const nestedItem = wrap(wrap(special));
console.log(show(nested), double(nested.value), show(nestedItem), nameOf(nestedItem.get()), nested.value.replace(-0), show(nested));

console.log(show(pick(true, item, 1)), show(pick(false, item, 1)), show(pick(true, 2, special)), show(pick(false, "a", undefined)));

const shelf = new Shelf(item);
const specials = new Shelf<Special>(special);
console.log(shelf.names(), specials.names());
shelf.push(special);
specials.push(new Special("another", 5));
console.log(shelf.names(), specials.names(), shelf.top === special, shelf.below === item, specials.top.extra, Object.keys(shelf).join());

console.log(JSON.stringify([ofItem, ofNumber, ofString, ofArray, nested, either, new Box(undefined), new Box(null)]));
console.log(nameOf(ofItem), item.name, item.count, special.count, ofItem.value === item, show(ofFunction.value), show(ofArray.value));
