// The run time remembers fields by shape and name, steps of key orders and transitions in tables that begin small.
// Here each of them grows while what it remembers is asked for again: answers have to stay those of the first time.
const numberOfClasses = 24;
const rounds = 3;
let checksum = 0;
function mix(text: string) {
  for (let i = 0; i < text.length; ++i) checksum = (checksum * 31 + text.charCodeAt(i)) | 0;
}

class Record0 { a: number; b: number; constructor(n: number) { this.a = n; this.b = n + 1; } get sum() { return this.a + this.b; } }
class Record1 { b: number; c: number; constructor(n: number) { this.b = n; this.c = n + 2; } get sum() { return this.b + this.c; } }
class Record2 { c: number; d: number; e: number; constructor(n: number) { this.c = n; this.d = n + 3; this.e = n + 4; } get sum() { return this.c + this.d + this.e; } }
class Record3 { e: number; constructor(n: number) { this.e = n; } get sum() { return this.e; } }
class Optional { first: number; odd?: number; third?: number; fifth?: number; constructor(n: number) { this.first = n; if (n % 2) this.odd = n; if (n % 3 === 0) this.third = n; if (n % 5 === 0) this.fifth = n; } }

const names: string[] = [];
for (let i = 0; i < 260; ++i) names.push("name" + ((i * 7919) % 1009).toString(36) + (i % 7));
const declared = ["a", "b", "c", "d", "e", "sum", "first", "odd", "third", "fifth"];

function make(kind: number, n: number): any {
  switch (kind % 5) {
    case 0: return new Record0(n);
    case 1: return new Record1(n);
    case 2: return new Record2(n);
    case 3: return new Record3(n);
    default: return new Optional(n);
  }
}

// Reads and tests by name, on objects of every class.
function ask(object: any, name: string) {
  return (name in object ? "+" : "-") + (Object.hasOwn(object, name) ? "o" : "") + String(object[name]);
}
for (let round = 0; round < rounds; ++round) {
  for (let i = 0; i < names.length; ++i) {
    const object = make(i + round, i);
    mix(ask(object, names[i]));
    mix(ask(object, declared[i % declared.length]));
    mix(Reflect.ownKeys(object).join());
  }
}

// Fields created in many orders, on classes and on literals, and the keys in the order of their creation.
function fill(object: any, from: number, count: number, step: number) {
  for (let i = 0; i < count; ++i) object[names[(from + i * step) % names.length]] = from + i;
  return object;
}
const kept: any[] = [];
for (let round = 0; round < rounds; ++round) {
  for (let i = 0; i < 90; ++i) {
    const object = fill(make(i, i), i * 3, 1 + i % 6, 1 + i % 11);
    const literal: any = fill({ a: i, b: round }, i * 5, 1 + i % 7, 1 + i % 13);
    const empty = fill({}, i * 2, 2 + i % 9, 1 + i % 17);
    mix(Object.keys(object).join() + "|" + JSON.stringify(literal) + "|" + JSON.stringify(Object.entries(empty)));
    if (i % 9 === 0) {
      delete object.a;
      delete empty[names[(i * 2) % names.length]];
      object.a = i;
      mix(Object.keys(object).join() + Object.keys(empty).join());
    }
    if (round === 0 && i % 4 === 0) kept.push(object, literal, empty);
  }
}

// The same once more behind what has grown: each object still answers as it did.
function optional(n: number, order: string) {
  const object: any = { first: n };
  for (const letter of order) {
    if (letter === "x") object.x = n;
    else if (letter === "y") object.y = String(n);
    else if (letter === "z") object.z = [n];
    else if (letter === "w") object.w = { n };
    else object[letter + n % 4] = letter;
  }
  return object;
}
const orders: string[] = [];
for (const p of ["x", "y", "z", "w"]) for (const q of ["y", "w", "z", "u"]) for (const r of ["z", "x", "v", "t"]) orders.push(p + q + r, r + p + q + "s");
for (let round = 0; round < rounds; ++round) {
  for (let i = 0; i < orders.length; ++i) {
    const object = optional(i, orders[i]);
    mix(JSON.stringify(object) + Object.keys(object).join());
    const copy = { ...object, last: i };
    Object.assign(copy, kept[i % kept.length]);
    mix(Object.keys(copy).join());
  }
}
for (const object of kept) {
  mix(JSON.stringify(object));
  for (let i = 0; i < names.length; i += 5) mix(ask(object, names[i]));
}

// Prototypes and setters under many names.
const methods: any = {};
for (let i = 0; i < 120; ++i) Object.defineProperty(methods, "m" + names[i], { get(this: any) { return this.base + i; }, set(this: any, value: number) { this.base = value - i; }, configurable: true, enumerable: i % 2 === 0 });
for (let round = 0; round < rounds; ++round) {
  for (let i = 0; i < 120; ++i) {
    const object = Object.create(methods);
    object.base = i;
    object["m" + names[(i * 7) % 120]] = i * 10;
    mix(String(object["m" + names[(i * 7) % 120]]) + String(object["m" + names[(i * 3) % 120]]) + Object.keys(object).join());
  }
}

// Declared fields created in more orders than the program numbers, and deleted from the middle.
class Wide {
  a?: number; b?: number; c?: number; d?: number; e?: number; f?: number; g?: number; h?: number;
}
const letters = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
function set(object: Wide, letter: number, value: number) {
  switch (letter) {
    case 0: object.a = value; break;
    case 1: object.b = value; break;
    case 2: object.c = value; break;
    case 3: object.d = value; break;
    case 4: object.e = value; break;
    case 5: object.f = value; break;
    case 6: object.g = value; break;
    default: object.h = value;
  }
}
function remove(object: Wide, letter: number) {
  switch (letter) {
    case 0: delete object.a; break;
    case 1: delete object.b; break;
    case 2: delete object.c; break;
    case 3: delete object.d; break;
    case 4: delete object.e; break;
    case 5: delete object.f; break;
    case 6: delete object.g; break;
    default: delete object.h;
  }
}
function permutation(number: number): number[] {
  const left = [0, 1, 2, 3, 4, 5, 6, 7];
  const result: number[] = [];
  while (left.length) {
    const place = number % left.length;
    number = (number - place) / left.length;
    result.push(left[place]);
    left.splice(place, 1);
  }
  return result;
}
for (let round = 0; round < 2; ++round) {
  for (let i = 0; i < 2400; ++i) {
    const order = permutation((i * 29) % 40320);
    const object = new Wide();
    for (let j = 0; j < 8; ++j) set(object, order[j], i + j);
    mix(Object.keys(object).join(""));
    remove(object, order[i % 8]);
    remove(object, order[(i + 3) % 8]);
    mix(Object.keys(object).join("") + JSON.stringify(object));
    set(object, order[i % 8], -i);
    mix(Object.keys(object).join(""));
  }
}

// Names added to functions and to prototypes, each pair of a structure and a name once, then again.
function makeFunctions() {
  const functions: any[] = [];
  for (let i = 0; i < 60; ++i) {
    const made: any = function () { return made.total; };
    for (let j = 0; j < 14; ++j) made[names[(i * 5 + j * (1 + i % 9)) % names.length]] = i * j;
    made.total = i;
    functions.push(made);
  }
  return functions;
}
for (let round = 0; round < rounds; ++round) {
  for (const made of makeFunctions()) mix(Object.keys(made).join() + made());
}

// Objects below prototypes of their own: each pair of a structure and a name is new, and comes again.
const parents: any[] = [];
for (let i = 0; i < 900; ++i) parents.push({ base: i });
for (let round = 0; round < rounds; ++round) {
  for (let i = 0; i < parents.length; ++i) {
    const below = Object.create(parents[i]);
    below[names[(i * 3) % names.length]] = i;
    below[names[(i * 5 + 1) % names.length]] = round;
    if (i % 50 === 0) mix(Object.keys(below).join() + below.base);
    checksum = (checksum + below[names[(i * 3) % names.length]] + below.base) | 0;
  }
}
console.log(numberOfClasses, kept.length, names.length, checksum);
