// A literal whose members the checker knows is handed to Object.create, is used by itself too, and changes meanwhile: every read below it sees the change.
const lines: string[] = [];
function say(label: string, value: unknown): void {
  lines.push(label + ": " + (typeof value === "string" ? value : JSON.stringify(value)));
}

const animal = {
  legs: 4,
  name: "animal",
  describe(): string {
    return this.name + " on " + this.legs;
  },
  get twice(): number {
    return this.legs * 2;
  },
  set twice(n: number) {
    this.legs = n / 2;
  },
};
type Animal = typeof animal;

function make(i: number): Animal {
  const made: Animal = Object.create(animal);
  if (i & 1) made.legs = i;
  return made;
}

function useBelow(i: number): string {
  const made = make(i);
  const before = made.describe() + "|" + made.twice;
  made.twice = 12;
  return before + "|" + made.legs + "|" + Object.keys(made).join() + "|" + ("name" in made) + "|" + Object.hasOwn(made, "name");
}

function useItself(): string {
  return animal.describe() + "|" + animal.twice + "|" + Object.keys(animal).join() + "|" + JSON.stringify(animal);
}

function walk(o: object): string {
  let names = "";
  for (const name in o) names += name + ";";
  return names;
}

// Functions whose parameter has the type of the literal, and that are only ever handed the literal.
function keysOf(v: Animal): string {
  let legs = 0;
  let others = "";
  for (const key of Object.keys(v)) {
    if (key === "legs") legs++;
    else others += key + ";";
  }
  return legs + ":" + others;
}
function legsOf(v: Animal): string {
  return typeof v.legs + " " + (v.legs + 1);
}
function nameOf(v: Animal): string {
  return typeof v.name + " " + v.name.length;
}
function looks(v: Animal): string {
  return [keysOf(v), legsOf(v), nameOf(v), Object.values(v).map(each => typeof each).join(), JSON.stringify(v), "legs" in v, Object.hasOwn(v, "twice")].join(" | ");
}
let seen = "";
for (let turn = 0; turn < 60; turn++) seen = looks(animal);
say("the literal under its own type", seen);

for (let i = 0; i < 30; i++) {
  const below = useBelow(i);
  const itself = useItself();
  if (i < 3 || i === 29) {
    say(i + " below", below);
    say(i + " itself", itself);
    say(i + " walk", walk(make(i)));
  }
}

animal.legs = 6;
say("legs stored above: below", useBelow(2));
say("legs stored above: itself", useItself());

animal.describe = function (this: Animal): string {
  return "replaced " + this.name;
};
say("method replaced: below", useBelow(2));
say("method replaced: itself", useItself());

Object.defineProperty(animal, "twice", {
  get(this: Animal): number {
    return this.legs * 3;
  },
  configurable: true,
  enumerable: false,
});
say("getter redefined: below", (() => {
  try {
    return useBelow(3);
  } catch (error) {
    return (error as Error).constructor.name;
  }
})());
say("getter redefined: itself", useItself());

Object.defineProperty(animal, "legs", { value: 8, writable: false, configurable: true, enumerable: true });
say("legs read-only above", (() => {
  try {
    return useBelow(5);
  } catch (error) {
    return (error as Error).constructor.name;
  }
})());
Object.defineProperty(animal, "legs", { value: 8, writable: true, configurable: true, enumerable: true });

delete (animal as Partial<Animal>).name;
say("name deleted above: below", (() => {
  try {
    return useBelow(4);
  } catch (error) {
    return (error as Error).constructor.name;
  }
})());
say("name deleted above: itself", useItself());

(animal as Animal & { added?: number }).added = 1;
say("name added above: walk", walk(make(1)));

Object.setPrototypeOf(animal, { name: "from higher up", higher: true });
say("another object above the literal: below", make(0).name + "|" + walk(make(1)));

const other = { legs: 2, name: "bird", describe: animal.describe, twice: 0 };
function makeBelow(above: Animal, i: number): string {
  const made: Animal = Object.create(above);
  made.legs += i;
  return made.describe() + "|" + made.legs + "|" + (Object.getPrototypeOf(made) === above);
}
for (let i = 0; i < 6; i++) say("two literals in turn " + i, makeBelow(i & 1 ? other : animal, i));

Object.assign(animal, { legs: "many", extra: 1, 0: "zero" });
say("written into by a built-in", (() => {
  try {
    return looks(animal) + " || " + walk(make(0));
  } catch (error) {
    return (error as Error).constructor.name;
  }
})());
Object.assign(animal, { legs: 8 });

Object.freeze(animal);
say("frozen above", (() => {
  "use strict";
  try {
    const made = make(0);
    made.legs = 1;
    return "stored " + made.legs;
  } catch (error) {
    return (error as Error).constructor.name;
  }
})());

const counters = {
  count: 0,
  bump(): number {
    return ++this.count;
  },
};
function bumpBelow(i: number): number {
  const made: typeof counters = Object.create(counters);
  made.bump();
  if (i % 3 === 0) counters.bump();
  return made.bump() * 100 + counters.count;
}
let sum = 0;
for (let i = 0; i < 50; i++) sum += bumpBelow(i);
say("a counter above and below", sum + "|" + counters.count);

console.log(lines.join("\n"));
