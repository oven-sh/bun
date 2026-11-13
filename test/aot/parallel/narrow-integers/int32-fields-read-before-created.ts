// An int32 field takes four bytes and has no value that means "not created yet". Its key order tells, whichever int32 it holds.
const numbers = [-2147483648, -2147483647, -2147483646, -2147483645, -2147483644, -2147483643, 2147483647, 0, -1, 1];
function at(index: number): number {
  return numbers[((index % 10) + 10) % 10]! | 0;
}
const lines: string[] = [];
const names = ["first", "second", "third"];
const listing = (object: object) => Object.keys(object).join() + " " + JSON.stringify(object);

class Listed {
  first: number;
  second: number;
  third: number;
  next: Listed | null;
  constructor(index: number, next: Listed | null) {
    lines.push(listing({ ...this }));
    this.first = at(index);
    lines.push(Object.keys(this).join(), String("first" in this), String("second" in this));
    this.second = 5;
    this.second = at(index + 1);
    lines.push(Object.keys(this).join(), String(this.last()), String(Object.hasOwn(this, names[index % 3]!)));
    this.third = at(index + 2);
    this.next = next;
    lines.push(Object.keys(this).join());
  }
  last() {
    return this.third;
  }
  sum() {
    return this.first + this.second + this.third;
  }
}

class Thrown {
  first: number;
  second!: number;
  next: Thrown | null;
  constructor(index: number, next: Thrown | null) {
    this.next = next;
    this.first = at(index);
    unfinished.push(this);
    if (index % 4 === 3) throw new Error("unfinished");
    this.second = at(index + 1);
  }
}
const unfinished: Thrown[] = [];

class Reflected {
  first: number;
  second: number;
  next: Reflected | null;
  constructor(index: number, next: Reflected | null) {
    this.next = next;
    Reflect.set(this, names[index % 2]!, at(index + 3));
    this.first = at(index);
    this.second = at(index + 1);
  }
}

class Assigned {
  first: number;
  second: number;
  third: number;
  next: Assigned | null;
  constructor(index: number, next: Assigned | null, from: object) {
    this.next = next;
    Object.assign(this, from);
    this.first = at(index);
    this.second = at(index + 1);
    this.third = at(index + 2);
  }
}

class Sometimes {
  first: number;
  second!: number;
  next: Sometimes | null;
  constructor(index: number, next: Sometimes | null) {
    this.next = next;
    this.first = at(index);
    if (index & 1) this.second = at(index + 1);
  }
}

let listed: Listed | null = null;
for (let i = 0; i < 20; i++) listed = new Listed(i, listed);
for (let one = listed; one; one = one.next) lines.push(one.sum() + " " + Object.keys(one).join());

let thrown: Thrown | null = null;
for (let i = 0; i < 20; i++) {
  try {
    thrown = new Thrown(i, thrown);
  } catch (error) {
    lines.push((error as Error).message);
  }
}
for (const one of unfinished) lines.push(Object.keys(one).join(), String(one.second), String("second" in one));

let reflected: Reflected | null = null;
for (let i = 0; i < 20; i++) reflected = new Reflected(i, reflected);
for (let one = reflected; one; one = one.next) lines.push(Object.keys(one).join(), `${one.first} ${one.second}`);

let assigned: Assigned | null = null;
for (let i = 0; i < 20; i++) assigned = new Assigned(i, assigned, i % 3 ? { third: at(i), first: at(i + 4) } : {});
for (let one = assigned; one; one = one.next) lines.push(Object.keys(one).join(), `${one.first} ${one.second} ${one.third}`);

let sometimes: Sometimes | null = null;
for (let i = 0; i < 20; i++) sometimes = new Sometimes(i, sometimes);
for (let one = sometimes; one; one = one.next) {
  one.first++;
  one.second++;
  lines.push(Object.keys(one).join(), `${one.first} ${one.second}`);
}

const doors: ((object: Listed, index: number) => unknown)[] = [
  (object, index) => (object[names[index % 3] as "first"] = at(index + 3)),
  (object, index) => Reflect.set(object, names[index % 3]!, at(index + 4)),
  (object, index) => Object.assign(object, { third: at(index), first: at(index + 1) }).second,
  (object, index) => Object.keys({ ...object, next: index }).join(),
  object => { const { first, ...rest } = object; return first + Object.keys(rest).join(); },
  (object, index) => Object.defineProperty(Object.create(object), "first", { value: at(index) }).first + object.first,
  object => Object.entries(object).map(([key]) => key).join(),
  object => JSON.stringify({ ...structuredClone({ ...object, next: null }) }),
  (object, index) => { Object.freeze(object); try { object.second = at(index); } catch (error) { return (error as Error).constructor.name; } },
];
let index = 0;
for (let one = listed; one; one = one.next) {
  lines.push(String(doors[index % doors.length]!(one, index)), `${one.first} ${one.second} ${one.third} ${one.sum()}`);
  index++;
}
console.log(lines.join("\n"));
