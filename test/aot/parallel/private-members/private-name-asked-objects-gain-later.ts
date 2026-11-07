// `#name in value` for values of every kind, again and again, while ordinary objects gain the name by a constructor that returns them, turn into dictionaries, or belong to another evaluation of the class.
const lines: string[] = [];
function say(label: string, value: unknown): void {
  lines.push(label + ": " + String(value));
}

class Branded {
  #brand = 1;
  static is(value: object): boolean {
    return #brand in value;
  }
}

const Returns = function (this: unknown, value: object): object {
  return value;
} as unknown as new (value: object) => object;
class Stamp extends Returns {
  #mark = 7;
  #method(): number {
    return this.#mark;
  }
  static has(value: object): boolean {
    return #mark in value;
  }
  static hasMethod(value: object): boolean {
    return #method in value;
  }
  static read(value: object): number {
    return (value as Stamp).#method();
  }
}

function makeClass() {
  return class Evaluated extends Returns {
    #own = 1;
    static has(value: object): boolean {
      return #own in value;
    }
  };
}
const First = makeClass();
const Second = makeClass();

const plain = { a: 1 };
const sameShape = { a: 2 };
const list = [1, 2];
const sameList = [3, 4];
const fn = function () {};
const proxy = new Proxy({ a: 1 }, {});
const frozen = Object.freeze({ a: 3 });
const bare = Object.create(null) as object;
const dictionary: Record<string, number> = {};
for (let i = 0; i < 200; i++) dictionary["k" + i] = i;
for (let i = 0; i < 150; i++) delete dictionary["k" + i];
const map = new Map<number, number>();
const all: object[] = [new Branded(), plain, sameShape, list, sameList, fn, proxy, frozen, bare, dictionary, map, new Branded()];

function ask(): string {
  let text = "";
  for (const value of all) text += (Branded.is(value) ? "B" : "-") + (Stamp.has(value) ? "S" : "-") + (Stamp.hasMethod(value) ? "M" : "-") + (First.has(value) ? "1" : "-") + (Second.has(value) ? "2" : "-") + " ";
  return text;
}
let last = "";
for (let turn = 0; turn < 40; turn++) last = ask();
say("before", last);

new Stamp(plain);
say("one of two objects of a shape is stamped", ask());
say("read", Stamp.read(plain));
new Stamp(list);
say("one of two arrays", ask());
new Stamp(dictionary);
say("a dictionary", ask());
new Stamp(proxy);
new Stamp(fn);
new Stamp(bare);
new Stamp(map);
say("a proxy, a function, an object below nothing, a map", ask());
new First(sameShape);
say("the first evaluation", ask());
new Second(sameShape);
new Second(sameList);
say("the second evaluation", ask());
say("a frozen object", (() => {
  try {
    new Stamp(frozen);
    return ask();
  } catch (error) {
    return (error as Error).constructor.name + " " + ask();
  }
})());
say("twice", (() => {
  try {
    new Stamp(plain);
    return "stamped again";
  } catch (error) {
    return (error as Error).constructor.name;
  }
})());
say("no object", (() => {
  try {
    return Branded.is(1 as unknown as object);
  } catch (error) {
    return (error as Error).constructor.name;
  }
})());
// Many shapes in turn: more than anything remembers.
let count = 0;
for (let turn = 0; turn < 400; turn++) {
  const value: Record<string, number> = {};
  value["p" + (turn % 37)] = turn;
  if (turn % 5 === 0) new Stamp(value);
  if (Stamp.has(value)) count++;
  if (Branded.is(value)) count += 1000;
}
say("many shapes", count);
console.log(lines.join("\n"));
