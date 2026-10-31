// `a.includes(x)`, `a.indexOf(x)` and `a.lastIndexOf(x)` in typed code, on arrays of numbers of every length from 0 to 40 and a few longer ones, so that both the short arrays that are compared in place and the long ones that are handed to the library take part. The arrays hold fractions, whole numbers (declared, pushed or parsed), an enum, or numbers in storage that once held a text. What is looked for: the element at the first, the second, the middle and the last place, the number just past the last one, fractions among whole numbers, numbers that are whole only after 32 bits are cut off, +0 and -0, NaN, the infinities, and things that are no numbers. Holes count as undefined for `includes` and as nothing for `indexOf`, unless a prototype has an element there; NaN is found by `includes` only, and a hole among fractions is no NaN. What was cut off an array is not found behind its end.
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

let events = "";
function attempt(run: () => string): string {
  let text: string;
  try {
    text = run();
  } catch (error) {
    text = "threw " + (error as Error).constructor.name;
  }
  if (events !== "") text += " (" + events.trim() + ")";
  events = "";
  return text;
}

// "n-1 n-1 n-1 y0" becomes "n-1*3 y0".
function inRuns(parts: string[]): string {
  let text = "";
  for (let i = 0; i < parts.length; ) {
    let end = i + 1;
    while (end < parts.length && parts[end] === parts[i]) end++;
    text += (i > 0 ? " " : "") + parts[i] + (end - i > 1 ? "*" + (end - i) : "");
    i = end;
  }
  return text;
}

enum Kind { Space, Word, Digit, Mark }
const nan = Number(JSON.parse('"x"'));

function has(a: number[], x: number): boolean { return a.includes(x); }
function where(a: number[], x: number): number { return a.indexOf(x); }
function whereLast(a: number[], x: number): number { return a.lastIndexOf(x); }
function hasFrom(a: number[], x: number, from: number): boolean { return a.includes(x, from); }
function whereFrom(a: number[], x: number, from: number): number { return a.indexOf(x, from); }
function hasKind(a: Kind[], x: Kind): boolean { return a.includes(x); }
function whereKind(a: Kind[], x: Kind): number { return a.indexOf(x); }
function hasAnything(a: unknown[], x: unknown): boolean { return a.includes(x); }
function whereAnything(a: unknown[], x: unknown): number { return a.indexOf(x); }
function branches(a: number[], x: number): string { return (a.includes(x) ? "i" : "o") + (!a.includes(x) ? "o" : "i") + (a.indexOf(x) === -1 ? "o" : "i") + (a.indexOf(x) !== -1 ? "i" : "o") + (a.indexOf(x) >= 0 ? "i" : "o") + (a.indexOf(x) < 0 ? "o" : "i") + (~a.indexOf(x) ? "i" : "o"); }
function found(a: number[], x: number): string { return (has(a, x) ? "y" : "n") + where(a, x) + (whereLast(a, x) === where(a, x) ? "" : "/" + whereLast(a, x)); }

function countHits(a: number[], wanted: number[]): number {
  let hits = 0;
  for (let i = 0; i < wanted.length; i++) if (a.includes(wanted[i])) hits++;
  return hits;
}

function sumOfPlaces(a: number[], wanted: number[]): number {
  let sum = 0;
  for (let i = 0; i < wanted.length; i++) sum += a.indexOf(wanted[i]);
  return sum;
}

// The element at place i is 2 i + 1, or half of that.
function wholeNumbers(length: number): number[] {
  const a: number[] = [];
  for (let i = 0; i < length; i++) a.push(i * 2 + 1);
  return a;
}

function fractions(length: number): number[] {
  const a: number[] = [];
  for (let i = 0; i < length; i++) a.push(i + 0.5);
  return a;
}

function parsedWholeNumbers(length: number): number[] {
  return JSON.parse("[" + wholeNumbers(length).join() + "]") as number[];
}

function parsedFractions(length: number): number[] {
  return JSON.parse("[" + fractions(length).join() + "]") as number[];
}

function storedWholeNumbers(length: number): number[] {
  const a = new Array<number>(length);
  for (let i = 0; i < length; i++) a[i] = i * 2 + 1;
  return a;
}

function onceHeldAText(length: number): number[] {
  const a: unknown[] = ["x"];
  a.pop();
  for (let i = 0; i < length; i++) a.push(i * 2 + 1);
  return a as number[];
}

function mappedWholeNumbers(length: number): number[] {
  return fractions(length).map(value => value * 2);
}

const lengths = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 63, 64, 65, 100, 1000];

function needlesFor(length: number, scale: number): number[] {
  const last = length - 1, middle = length >> 1;
  return [
    1 * scale, 3 * scale, (middle * 2 + 1) * scale, (last * 2 - 1) * scale, (last * 2 + 1) * scale, (last * 2 + 3) * scale,
    0, -0, 2, 1.5, 0.25, 1.0000000000000002, -1, -0.5, nan, Infinity, -Infinity,
    2147483648, -2147483648, 2147483649, 4294967296, 4294967297, 4294967299, -4294967295, 4294967296.5, 1e300, 5e-324,
  ];
}

const builders: [string, (length: number) => number[], number][] = [
  ["whole numbers", wholeNumbers, 1],
  ["fractions", fractions, 0.5],
  ["parsed whole numbers", parsedWholeNumbers, 1],
  ["parsed fractions", parsedFractions, 0.5],
  ["whole numbers stored into new Array(n)", storedWholeNumbers, 1],
  ["whole numbers where a text was", onceHeldAText, 1],
  ["whole numbers out of map", mappedWholeNumbers, 1],
];
console.log("looked for, in 5 whole numbers: " + needlesFor(5, 1).map(show).join(" "));
console.log("looked for, in 5 fractions: " + needlesFor(5, 0.5).map(show).join(" "));
for (const [name, build, scale] of builders) {
  for (const length of lengths) {
    const a = build(length), needles = needlesFor(length, scale);
    const first = inRuns(needles.map(x => found(a, x))), second = inRuns(needles.map(x => found(a, x)));
    console.log(name + ", " + length + ": " + first + (first === second ? "" : " then " + second) + " | " + countHits(a, needles) + " " + sumOfPlaces(a, needles) + " " + inRuns(needles.slice(3, 9).map(x => branches(a, x))));
  }
}

// Every place of every short array.
for (const [name, build, scale] of builders) {
  let wrong = 0;
  for (let length = 0; length <= 40; length++) {
    const a = build(length);
    for (let place = -1; place <= length; place++) {
      const x = (place * 2 + 1) * scale, expected = place >= 0 && place < length ? place : -1;
      if (where(a, x) !== expected || has(a, x) !== expected >= 0 || whereLast(a, x) !== expected) wrong++;
      if (has(a, x + 0.125) || where(a, x + 0.125) !== -1) wrong++;
    }
  }
  console.log(name + ", every place: " + wrong + " wrong");
}

// An enum: few values, many times.
function kinds(length: number): Kind[] {
  const a: Kind[] = [];
  for (let i = 0; i < length; i++) a.push(i + 1 === length ? Kind.Mark : i % 5 === 3 ? Kind.Digit : Kind.Word);
  return a;
}
for (const length of lengths) {
  const a = kinds(length), parsed = JSON.parse("[" + a.join() + "]") as Kind[];
  console.log("an enum, " + length + ": " + [Kind.Space, Kind.Word, Kind.Digit, Kind.Mark, 4 as Kind, -1 as Kind, 0.5 as Kind, nan as Kind].map(x => (hasKind(a, x) ? "y" : "n") + whereKind(a, x) + (hasKind(parsed, x) ? "y" : "n") + whereKind(parsed, x)).join(" "));
}

// Zeros of both signs, at the last place and elsewhere.
function withLast(a: number[], value: number): number[] {
  a.push(value);
  return a;
}
function withFirst(a: number[], value: number): number[] {
  a[0] = value;
  return a;
}
for (const length of [0, 1, 2, 15, 16, 17, 40]) {
  console.log("zeros, " + length + ": " + [0, -0].map(zero => [wholeNumbers, fractions, parsedWholeNumbers, onceHeldAText].map(build => {
    const atTheEnd = withLast(build(length), zero), atTheStart = withFirst(build(length + 1), zero);
    return found(atTheEnd, 0) + found(atTheEnd, -0) + found(atTheStart, 0) + found(atTheStart, -0) + show(atTheEnd[length]);
  }).join(" ")).join(" ; "));
}

// NaN, holes and undefined.
const absent = undefined as unknown as number;
function lookedForAmongOdd(a: number[]): string {
  return "NaN " + found(a, nan) + " undefined " + found(a, absent) + " null " + found(a, null as unknown as number) + " 0 " + found(a, 0) + " first " + found(a, a[0]) + " last " + found(a, a[a.length - 1]);
}
function changed(a: number[], change: (a: number[]) => void): number[] {
  change(a);
  return a;
}
const odd: [string, (a: number[]) => void][] = [
  ["nothing", () => {}],
  ["NaN at the end", a => { a.push(nan); }],
  ["NaN at the start", a => { a[0] = nan; }],
  ["NaN twice", a => { a[0] = nan; a.push(nan); }],
  ["a hole at the start", a => { delete a[0]; }],
  ["a hole in the middle", a => { delete a[a.length >> 1]; }],
  ["a hole at the last place", a => { delete a[a.length - 1]; }],
  ["a hole behind the last element", a => { a.length += 1; }],
  ["a hole and NaN", a => { delete a[0]; a.push(nan); }],
  ["undefined at the end", a => { a.push(absent); }],
  ["undefined at the start", a => { a[0] = absent; }],
  ["undefined and a hole", a => { delete a[0]; a.push(absent); }],
  ["null at the end", a => { a.push(null as unknown as number); }],
  ["a text at the end", a => { a.push("1" as unknown as number); }],
];
for (const [what, change] of odd) {
  for (const [name, build] of builders.slice(0, 3)) {
    console.log(what + ", " + name + ": " + [1, 2, 3, 15, 16, 17, 18, 40].map(length => lookedForAmongOdd(changed(build(length), change))).join(" ; "));
  }
}
for (const length of [0, 1, 2, 16, 17, 40]) console.log("only holes, " + length + ": " + lookedForAmongOdd(new Array<number>(length)) + " ; " + lookedForAmongOdd(changed([], a => (a.length = length))));

// A hole over an element of a prototype that took the place of Array.prototype.
for (const length of [3, 16, 17, 40]) {
  console.log("a hole over a prototype's element, " + length + ": " + [wholeNumbers, fractions, parsedWholeNumbers].map(build => {
    const a = build(length);
    delete a[1];
    Object.setPrototypeOf(a, { __proto__: Array.prototype, 1: 77, [length]: 88 });
    return found(a, 77) + " " + found(a, 88) + " " + found(a, absent) + " " + found(a, a[2]) + " " + found(a, nan);
  }).join(" ; "));
}

// What an array held before it became shorter.
const shortenings: [string, (a: number[]) => void][] = [
  ["length - 1", a => { a.length -= 1; }],
  ["length = 1", a => { a.length = 1; }],
  ["length = 0", a => { a.length = 0; }],
  ["pop", a => { a.pop(); }],
  ["pop twice, push", a => { a.pop(); a.pop(); a.push(-5); }],
  ["shift", a => { a.shift(); }],
  ["splice at the end", a => { a.splice(a.length - 2, 2); }],
  ["splice at the start", a => { a.splice(0, 2); }],
  ["shorter, then longer", a => { a.length -= 2; a.length += 2; }],
];
for (const [what, shorten] of shortenings) {
  for (const [name, build, scale] of builders.slice(0, 3)) {
    console.log(what + ", " + name + ": " + [2, 3, 16, 17, 18, 40, 70].map(length => {
      const a = changed(build(length), shorten);
      return [0, 1, length - 3, length - 2, length - 1].map(place => found(a, (place * 2 + 1) * scale)).join("") + found(a, absent) + found(a, -5);
    }).join(" ; "));
  }
}

// Where the search starts.
const starts = [0, 1, 2, 15, 16, 17, 39, 40, 41, -1, -2, -16, -17, -40, -41, 0.5, 1.9, -0.5, -0, nan, Infinity, -Infinity, 4294967296, -4294967296];
console.log("starts: " + starts.map(show).join(" "));
for (const [name, build, scale] of builders.slice(0, 3)) {
  for (const length of [0, 1, 2, 16, 17, 40]) {
    const a = build(length);
    console.log("from a start, " + name + ", " + length + ": " + [0, 1, length - 1].map(place => inRuns(starts.map(from => (hasFrom(a, (place * 2 + 1) * scale, from) ? "y" : "n") + whereFrom(a, (place * 2 + 1) * scale, from)))).join(" ; ") + " ; " + inRuns(starts.map(from => (hasFrom(a, absent, from) ? "y" : "n") + (hasFrom(a, nan, from) ? "y" : "n"))));
  }
}
console.log("a start that is undefined: " + hasFrom(wholeNumbers(3), 1, absent) + " " + whereFrom(wholeNumbers(3), 1, absent) + " " + hasFrom(fractions(20), 0.5, absent) + " " + whereFrom(fractions(20), 0.5, absent));
for (const length of [3, 16, 17, 40]) {
  console.log("a start that changes the array, " + length + ": " + [wholeNumbers, fractions, parsedWholeNumbers].map(build => [
    (a: number[]) => { a.length = 0; },
    (a: number[]) => { a.length = 1; },
    (a: number[]) => { a.push(-5); },
    (a: number[]) => { a[a.length - 1] = -5; },
    (a: number[]) => { a[1] = nan; },
    (a: number[]) => { a[1] = "text" as unknown as number; },
    (a: number[]) => { delete a[1]; },
  ].map(change => {
    const run = (search: (a: number[], x: number, from: number) => unknown, x: (a: number[]) => number): string => {
      const a = build(length);
      const wanted = x(a);
      return attempt(() => show(search(a, wanted, { valueOf() { events += " valueOf"; change(a); return 0; } } as unknown as number)));
    };
    return run(hasFrom, a => a[a.length - 1]) + " " + run(whereFrom, a => a[a.length - 1]) + " " + run(hasFrom, () => absent) + " " + run(whereFrom, () => -5) + " " + run(hasFrom, () => nan) + " " + run(whereFrom, a => a[0]);
  }).join(" , ")).join(" ; "));
}

// What is no number is looked for among numbers, and numbers among anything.
const strangers: unknown[] = [undefined, null, true, false, "1", "", 1n, 0n, {}, [], [1], Symbol.iterator, { valueOf: () => 1 }];
for (const length of [0, 1, 2, 16, 17, 40]) {
  console.log("strangers, " + length + ": " + [wholeNumbers, fractions, parsedWholeNumbers, onceHeldAText].map(build => {
    const a = build(length);
    return inRuns(strangers.map(x => found(a, x as number) + (hasAnything(a, x) ? "y" : "n") + whereAnything(a, x)));
  }).join(" ; "));
}
const item = { id: 1 }, mixture: unknown[] = [1, 0.5, "1", item, null, undefined, nan, -0, 1n, true, , [1]];
console.log("among anything: " + [1, 0.5, "1", item, { id: 1 }, null, undefined, nan, 0, -0, 1n, 2n, true, false, "", 2].map(x => (hasAnything(mixture, x) ? "y" : "n") + whereAnything(mixture, x)).join(" "));

// Arrays that are not plain, or whose methods are their own.
class Numbers extends Array<number> {}
class Loud extends Array<number> {
  includes(x: number, from?: number): boolean {
    events += " own includes";
    return super.includes(x, from);
  }
  indexOf(x: number, from?: number): number {
    events += " own indexOf";
    return super.indexOf(x, from) + 100;
  }
}
const logging: ProxyHandler<number[]> = {
  get(target, key, receiver) {
    events += " get:" + String(key);
    return Reflect.get(target, key, receiver);
  },
  has(target, key) {
    events += " has:" + String(key);
    return Reflect.has(target, key);
  },
};
function fill(a: number[], length: number): number[] {
  for (let i = 0; i < length; i++) a.push(i * 2 + 1);
  return a;
}
const notPlain: [string, (length: number) => number[]][] = [
  ["frozen", length => Object.freeze(wholeNumbers(length)) as number[]],
  ["frozen fractions", length => Object.freeze(fractions(length)) as number[]],
  ["sealed", length => Object.seal(wholeNumbers(length))],
  ["a subclass", length => fill(new Numbers(), length)],
  ["a subclass with methods of its own", length => fill(new Loud(), length)],
  ["an own includes", length => changed(wholeNumbers(length), a => { (a as unknown as { includes: unknown }).includes = () => { events += " own property"; return false; }; })],
  ["an own indexOf", length => changed(fractions(length), a => { (a as unknown as { indexOf: unknown }).indexOf = () => { events += " own property"; return 55; }; })],
  ["methods on another prototype", length => changed(wholeNumbers(length), a => Object.setPrototypeOf(a, { __proto__: Array.prototype, includes() { events += " prototype's"; return true; } }))],
  ["an own name", length => changed(wholeNumbers(length), a => { (a as unknown as Record<string, number>).label = 1; })],
  ["a getter at 1", length => changed(wholeNumbers(length), a => Object.defineProperty(a, 1, { get() { events += " getter"; return 3; }, enumerable: true, configurable: true }))],
  ["was sparse", length => changed(wholeNumbers(length), a => { a[1000000] = 1; a.length = length; })],
  ["a proxy", length => new Proxy(wholeNumbers(Math.min(length, 3)), logging)],
];
for (const [name, build] of notPlain) {
  console.log(name + ": " + [2, 16, 17, 40].map(length => {
    const a = build(length);
    return [1, 3, length * 2 - 1, length * 2 + 1, 0.5, nan].map(x => attempt(() => (has(a, x) ? "y" : "n") + where(a, x))).join(" ");
  }).join(" ; "));
}

// Literals, as short as they come.
function inPair(x: number): boolean { return [1, 2].includes(x); }
function inPairOfFractions(x: number): boolean { return [0.5, 1.5].includes(x); }
function placeInTriple(x: number): number { return [10, 20, 30].indexOf(x); }
function inVariables(x: number, p: number, q: number): boolean { return [p, q].includes(x); }
function placeInVariables(x: number, p: number, q: number, r: number): number { return [p, q, r].indexOf(x); }
const table: number[] = [2, 3, 5, 7, 11, 13];
const tableOfFractions: number[] = [0.25, 0.5, 0.75];
function inTable(x: number): boolean { return table.includes(x); }
function placeInTableOfFractions(x: number): number { return tableOfFractions.indexOf(x); }
console.log("literals: " + [0, 1, 2, 3, 0.5, 1.5, -0, nan, 10, 20, 30, 13, 0.75, 4294967297].map(x => (inPair(x) ? "y" : "n") + (inPairOfFractions(x) ? "y" : "n") + placeInTriple(x) + (inVariables(x, 1, nan) ? "y" : "n") + (inVariables(x, -0, 0.5) ? "y" : "n") + placeInVariables(x, 30, nan, 0) + (inTable(x) ? "y" : "n") + placeInTableOfFractions(x)).join(" "));

// Arrays that only typed code ever sees: each group is built, changed and searched by functions of its own, and only texts leave it.
function buildOwnWhole(length: number): number[] {
  const a: number[] = [];
  for (let i = 0; i < length; i++) a.push((i * 2 + 1) | 0);
  return a;
}
function searchOwnWhole(a: number[], x: number): string {
  return (a.includes(x) ? "y" : "n") + a.indexOf(x);
}
function buildOwnFractions(length: number): number[] {
  const a: number[] = [];
  for (let i = 0; i < length; i++) a.push(i + 0.5);
  return a;
}
function searchOwnFractions(a: number[], x: number): string {
  return (a.includes(x) ? "y" : "n") + a.indexOf(x);
}
function buildOwnWithHole(length: number): number[] {
  const a: number[] = [];
  for (let i = 0; i < length; i++) a.push(i + 0.5);
  delete a[length >> 1];
  return a;
}
function searchOwnWithHole(a: number[], x: number): string {
  return (a.includes(x) ? "y" : "n") + a.indexOf(x);
}
function buildOwnWithNaN(length: number, zero: number): number[] {
  const a: number[] = [];
  for (let i = 0; i < length; i++) a.push(i === length >> 1 ? zero / zero : i + 0.5);
  return a;
}
function searchOwnWithNaN(a: number[], x: number): string {
  return (a.includes(x) ? "y" : "n") + a.indexOf(x);
}
for (const length of [0, 1, 2, 3, 15, 16, 17, 18, 40, 100]) {
  const whole = buildOwnWhole(length), halves = buildOwnFractions(length), holed = buildOwnWithHole(length), withNaN = buildOwnWithNaN(length, length - length);
  console.log("seen by typed code only, " + length + ": "
    + [1, length * 2 - 1, length * 2 + 1, 1.5, 0, nan, 4294967297].map(x => searchOwnWhole(whole, x)).join(" ") + " ; "
    + [0.5, length - 0.5, length + 0.5, 1, 0, nan].map(x => searchOwnFractions(halves, x)).join(" ") + " ; "
    + [0.5, length - 0.5, (length >> 1) + 0.5, nan, absent].map(x => searchOwnWithHole(holed, x)).join(" ") + " ; "
    + [0.5, length - 0.5, (length >> 1) + 0.5, nan, absent].map(x => searchOwnWithNaN(withNaN, x)).join(" "));
}
