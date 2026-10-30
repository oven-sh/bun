// A constructor hands `this` to code nobody has seen before its first store, so no order of its fields is known at the build; each class of the chain creates some fields only under a condition.
// Every store that creates a field then finds another list of keys in front of it from one object to the next. The keys of each object come out in the sequence in which that object got them.
const seen: any[] = [];
const note: any = (globalThis as any).noteForThisTest ?? ((object: any) => { if (seen.length < 4) seen.push(object); });

class Base {
  declare id: number;
  declare label?: string;
  declare count?: number;
  declare tail: boolean;
  constructor(kind: number) {
    note(this);
    this.id = kind;
    if (kind & 1) this.label = "label" + kind;
    if (kind & 2) this.count = kind * 10;
    this.tail = true;
  }
}

class Middle extends Base {
  declare first?: object | null;
  declare second: string;
  declare third?: number;
  constructor(kind: number) {
    super(kind);
    if (kind & 4) this.first = null;
    this.second = "s";
    if (kind & 8) this.third = 3;
    if (kind & 16) this.second = "again";
  }
}

class Leaf extends Middle {
  declare a: number;
  declare b?: number;
  declare c: number;
  constructor(kind: number) {
    super(kind);
    this.a = 1;
    if (kind & 32) this.b = 2;
    this.c = 3;
    if (kind & 64) this.label = "late";
    if (kind & 128) this.count = -1;
  }
}

function describe(object: object) {
  return Object.keys(object).join() + " | " + JSON.stringify(object);
}

const lines = new Map<string, number>();
for (let round = 0; round < 6; round++) {
  for (let kind = 0; kind < 256; kind++) {
    const line = kind + ": " + describe(new Leaf(kind));
    lines.set(line, (lines.get(line) ?? 0) + 1);
  }
}
console.log(lines.size, [...lines.values()].every(times => times === 6));
for (const kind of [0, 1, 2, 3, 4, 12, 21, 32, 63, 64, 65, 128, 130, 192, 255]) console.log(describe(new Leaf(kind)));

for (let turn = 0; turn < 2000; turn++) new Leaf(37);
console.log(describe(new Leaf(37)), describe(new Leaf(36)), describe(new Leaf(37)));

function fillLate(object: any, kind: number) {
  if (kind & 1) object.extraOne = 1;
  object.extraTwo = 2;
  if (kind & 2) object.b = 20;
  object.extraTwo = 22;
  if (kind & 4) delete object.a;
  object.a = 100;
  return object;
}
for (let kind = 0; kind < 8; kind++) console.log(kind, describe(fillLate(new Leaf(kind * 5), kind)), describe(fillLate(new Middle(kind * 3), kind)));

const closed: string[] = [];
for (const close of [Object.preventExtensions, Object.seal, Object.freeze]) {
  const hold: any = (object: any) => { close(object); };
  (globalThis as any).noteForThisTest = hold;
  class Closed {
    declare x: number;
    constructor() {
      hold(this);
      this.x = 1;
    }
  }
  try {
    closed.push(describe(new Closed()));
  } catch (error) {
    closed.push((error as Error).constructor.name);
  }
}
console.log(closed.join(" . "));
console.log(seen.length, seen.map(object => Object.keys(object).length).join());
