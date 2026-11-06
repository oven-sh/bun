// Private names of classes with built-in parents, read and stored in loops: objects of several shapes, storage that moves between two accesses, cells stored into old objects, and a first instance made inside the loop.
class Failure extends Error {
  #code: number;
  #note: string;
  #owner: object | null = null;
  constructor(code: number, message?: string) {
    super(message);
    this.#code = code;
    this.#note = "note " + code;
  }
  static code(failure: Failure): number {
    return failure.#code;
  }
  static note(failure: Failure): string {
    return failure.#note;
  }
  static owner(failure: Failure): object | null {
    return failure.#owner;
  }
  static raise(failure: Failure, by: number): void {
    failure.#code = failure.#code + by;
  }
  static rename(failure: Failure, note: string): void {
    failure.#note = note;
  }
  static own(failure: Failure, owner: object | null): void {
    failure.#owner = owner;
  }
}

class Timeout extends Failure {
  #after: number;
  constructor(after: number) {
    super(after * 2, "timeout");
    this.#after = after;
  }
  static after(timeout: Timeout): number {
    return timeout.#after;
  }
  static delay(timeout: Timeout, by: number): void {
    timeout.#after += by;
  }
}

class Wide extends Map<string, number> {
  #a = 1; #b = 2; #c = 3; #d = 4; #e = 5; #f = 6; #g = 7; #h = 8; #i = 9; #j = 10;
  static sum(wide: Wide): number {
    return wide.#a + wide.#b + wide.#c + wide.#d + wide.#e + wide.#f + wide.#g + wide.#h + wide.#i + wide.#j;
  }
  static shift(wide: Wide): void {
    const first = wide.#a;
    wide.#a = wide.#b; wide.#b = wide.#c; wide.#c = wide.#d; wide.#d = wide.#e; wide.#e = wide.#f;
    wide.#f = wide.#g; wide.#g = wide.#h; wide.#h = wide.#i; wide.#i = wide.#j; wide.#j = first;
  }
  static ends(wide: Wide): string {
    return wide.#a + " " + wide.#j;
  }
}

class Row extends Array<number> {
  #tag = "row";
  #reads = 0;
  static tag(row: Row): string {
    row.#reads++;
    return row.#tag;
  }
  static reads(row: Row): number {
    return row.#reads;
  }
}

// One shape.
const plain = new Failure(1, "plain");
let total = 0;
for (let index = 0; index < 20000; index++) {
  Failure.raise(plain, index & 3);
  total = (total + Failure.code(plain)) | 0;
}
console.log("one shape", total, Failure.code(plain), Failure.note(plain));

// Five shapes, more than compiled code looks for by itself, one of them frozen and one a dictionary.
const withoutMessage = new Failure(2);
const withExtra = Object.assign(new Failure(3, "extra"), { extra: 1 });
const withMore = Object.assign(new Failure(4, "more"), { other: 1, more: 2 });
const frozen = Object.freeze(new Failure(5, "frozen")) as Failure;
const dictionary = new Failure(6, "dictionary") as Failure & Record<string, number>;
for (let index = 0; index < 80; index++) dictionary["key" + index] = index;
for (let index = 0; index < 80; index += 2) delete dictionary["key" + index];
const shapes: Failure[] = [plain, withoutMessage, withExtra, withMore, frozen, dictionary];
total = 0;
for (let index = 0; index < 30000; index++) {
  const failure = shapes[index % shapes.length];
  Failure.raise(failure, 1);
  total = (total + Failure.code(failure)) | 0;
}
console.log("six shapes", total, shapes.map(Failure.code).join(" "), shapes.map(Failure.note).join("|"));

// The storage of the object moves between two accesses.
const growing = new Failure(7, "growing") as Failure & Record<string, number>;
total = 0;
for (let index = 0; index < 3000; index++) {
  const before = Failure.code(growing);
  growing["added" + index] = index;
  Failure.raise(growing, 1);
  total = (total + before + Failure.code(growing) + Failure.note(growing).length) | 0;
}
console.log("growing", total, Failure.code(growing), Object.keys(growing).length);

// A name of the parent and a name of the child on one object.
const timeouts = [new Timeout(1), new Timeout(2), Object.assign(new Timeout(3), { extra: true })];
total = 0;
for (let index = 0; index < 20000; index++) {
  const timeout = timeouts[index % 3];
  Timeout.delay(timeout, 1);
  Failure.raise(timeout, 2);
  total = (total + Timeout.after(timeout) + Failure.code(timeout)) | 0;
}
console.log("parent and child", total, timeouts.map(Timeout.after).join(" "), timeouts.map(Failure.code).join(" "));

// Ten names, most of them outside the cell.
const wide = new Wide();
total = 0;
for (let index = 0; index < 20003; index++) {
  Wide.shift(wide);
  total = (total + Wide.sum(wide)) | 0;
}
console.log("wide", total, Wide.ends(wide));

// An array, whose elements share the storage with the names.
const row = new Row();
let tags = 0;
for (let index = 0; index < 5000; index++) {
  row.push(index);
  tags += Row.tag(row).length;
}
console.log("row", tags, Row.reads(row), row.length, row[4999]);

// New cells stored into objects that have survived collections.
const old: Failure[] = [];
for (let index = 0; index < 64; index++) old.push(new Failure(index, "old " + index));
Bun.gc(true);
Bun.gc(true);
for (let round = 0; round < 40; round++) {
  for (let index = 0; index < old.length; index++) {
    Failure.own(old[index], { round, index });
    Failure.rename(old[index], "renamed " + round + " " + index);
  }
  const garbage: object[] = [];
  for (let index = 0; index < 4000; index++) garbage.push({ index, text: "garbage " + index });
  if (round % 8 === 7) Bun.gc(true);
}
Bun.gc(true);
console.log("old", old.every((failure, index) => JSON.stringify(Failure.owner(failure)) === `{"round":39,"index":${index}}` && Failure.note(failure) === "renamed 39 " + index));

// The first instance of the class is made inside the loop that reads it.
class Late extends Set<number> {
  #seen = 0;
  static see(late: Late): number {
    late.#seen = late.#seen + 1;
    return late.#seen;
  }
}
let late: Late | null = null;
total = 0;
for (let index = 0; index < 20000; index++) {
  late ??= new Late();
  total = (total + Late.see(late)) | 0;
}
console.log("late", total);

// An object that lacks the name.
for (const [name, read] of [["code", Failure.code], ["after", Timeout.after], ["sum", Wide.sum]] as [string, (object: unknown) => unknown][]) {
  for (const object of [new Error("plain"), plain, new Map(), {}, null]) {
    try {
      console.log(name, typeof read(object));
    } catch (error) {
      console.log(name, "throws", (error as Error).constructor.name);
    }
  }
}
