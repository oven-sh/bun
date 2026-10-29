// `push` onto arrays whose storage is full, from the first element to past 100,000, where the engine starts to think about sparse arrays: whole numbers, fractions, 32-bit integers of an enum, objects, texts, a mixture, two and three operands at once, and `a[a.length] = v` beside them. The counts lie around the lengths at which the way of growing changes (64, 1,024, 100,000). The arrays start empty, as a literal whose storage is shared until the first store, parsed, sliced, emptied after they had grown, with holes, with named properties of their own (which live in front of the elements), as a subclass, sparse, or over a prototype with a setter ahead. NaN comes at the end of an array of fractions. Each time: what push returns, the length, a checksum over every element, no hole inside and nothing but holes behind the end. Objects are pushed into arrays that the collector has seen before.
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
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

const shell = globalThis as unknown as { fullGC?: () => void; edenGC?: () => void };
function collect(full: boolean): void {
  if (shell.fullGC && shell.edenGC) (full ? shell.fullGC : shell.edenGC)();
  else Bun.gc(full);
}

enum Kind { Space, Word, Digit, Mark }
interface Item { id: number }
const nan = Number(JSON.parse('"x"'));

// What is behind the end of an array shows when the length grows over it.
function tail(a: unknown[]): string {
  const length = a.length;
  a.length = length + 3;
  const isEmpty = !(length in a) && !(length + 1 in a) && !(length + 2 in a) && a[length] === undefined && a[length + 2] === undefined;
  a.length = length;
  return isEmpty ? "" : " something behind the end";
}

function reportNumbers(a: number[]): string {
  let sum = 0, holes = 0, nans = 0, infinities = 0;
  for (let i = 0; i < a.length; i++) {
    const value = a[i];
    if (!(i in a)) holes++;
    else if (value !== value) nans++;
    else if (value === Infinity || value === -Infinity) infinities++;
    else sum = (sum * 31 + value * 4) % 1000000007;
  }
  return a.length + "/" + sum + (holes > 0 ? "/" + holes + " holes" : "") + (nans > 0 ? "/" + nans + " NaN" : "") + (infinities > 0 ? "/" + infinities + " infinite" : "") + tail(a);
}

function reportAnything(a: unknown[]): string {
  let sum = 0, holes = 0;
  for (let i = 0; i < a.length; i++) {
    const value = a[i];
    if (!(i in a)) holes++;
    else if (typeof value === "number") sum = (sum * 31 + value * 4) % 1000000007;
    else if (typeof value === "string") sum = (sum * 31 + value.length + Number(value.slice(1))) % 1000000007;
    else if (typeof value === "object" && value !== null) sum = (sum * 31 + (value as Item).id + 7) % 1000000007;
    else sum = (sum * 31 + 5) % 1000000007;
  }
  return a.length + "/" + sum + (holes > 0 ? "/" + holes + " holes" : "") + tail(a);
}

// Each returns what the last push returned.
function pushWhole(a: number[], count: number): number {
  let last = -1;
  for (let i = 0; i < count; i++) last = a.push(i * 3 + 1);
  return last;
}

function pushFractions(a: number[], count: number): number {
  let last = -1;
  for (let i = 0; i < count; i++) last = a.push(i + 0.25);
  return last;
}

function pushWholeThenFractions(a: number[], count: number): number {
  let last = -1;
  for (let i = 0; i < count; i++) last = a.push(i * 2 < count ? i : i + 0.5);
  return last;
}

function pushKinds(a: Kind[], count: number): number {
  let last = -1;
  for (let i = 0; i < count; i++) last = a.push(((i * 7) & 3) as Kind);
  return last;
}

function pushItems(a: Item[], count: number): number {
  let last = -1;
  for (let i = 0; i < count; i++) last = a.push({ id: i });
  return last;
}

function pushTexts(a: string[], count: number): number {
  let last = -1;
  for (let i = 0; i < count; i++) last = a.push("t" + i);
  return last;
}

function pushAnything(a: unknown[], count: number): number {
  let last = -1;
  for (let i = 0; i < count; i++) last = a.push(i % 4 === 0 ? i : i % 4 === 1 ? i + 0.5 : i % 4 === 2 ? "t" + i : { id: i });
  return last;
}

function pushWholeAsAnything(a: unknown[], count: number): number {
  let last = -1;
  for (let i = 0; i < count; i++) last = a.push(i * 3 + 1);
  return last;
}

function pushPairs(a: number[], count: number): number {
  let last = -1;
  for (let i = 0; i + 1 < count; i += 2) last = a.push(i, i + 1.5);
  return last;
}

function pushTriples(a: number[], count: number): number {
  let last = -1;
  for (let i = 0; i + 2 < count; i += 3) last = a.push(i, i + 1, i + 2);
  return last;
}

function pushWithoutResult(a: number[], count: number): number {
  for (let i = 0; i < count; i++) a.push(i + 0.75);
  return a.length;
}

function appendWhole(a: number[], count: number): number {
  for (let i = 0; i < count; i++) a[a.length] = i * 3 + 1;
  return a.length;
}

function appendFractions(a: number[], count: number): number {
  for (let i = 0; i < count; i++) a[a.length] = i + 0.25;
  return a.length;
}

function pushOne(a: number[], v: number): number {
  return a.push(v);
}

function pushOneKind(a: Kind[], v: Kind): number {
  return a.push(v);
}

function buildWhole(count: number): number[] {
  const a: number[] = [];
  for (let i = 0; i < count; i++) a.push(i * 3 + 1);
  return a;
}

function buildFractions(count: number): number[] {
  const a: number[] = [];
  for (let i = 0; i < count; i++) a.push(i + 0.25);
  return a;
}

function buildKinds(count: number): Kind[] {
  const a: Kind[] = [];
  for (let i = 0; i < count; i++) a.push(((i * 7) & 3) as Kind);
  return a;
}

function buildWhile(limit: number): number[] {
  const a: number[] = [];
  let next = 0.5;
  while (next < limit) {
    a.push(next);
    next += 1;
  }
  return a;
}

const counts = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 15, 16, 17, 24, 25, 26, 31, 32, 33, 47, 48, 49, 63, 64, 65, 66, 95, 96, 97, 98, 99, 127, 128, 129, 145, 146, 147, 255, 256, 257, 511, 513, 1023, 1024, 1025, 1026, 1535, 1537, 4095, 4097, 9999, 10001, 99999, 100000, 100001, 100002];
console.log("counts: " + counts.join(" "));

const intoEmpty: [string, (count: number) => string][] = [
  ["whole numbers", count => { const a: number[] = []; return pushWhole(a, count) + " " + reportNumbers(a); }],
  ["fractions", count => { const a: number[] = []; return pushFractions(a, count) + " " + reportNumbers(a); }],
  ["whole numbers, then fractions", count => { const a: number[] = []; return pushWholeThenFractions(a, count) + " " + reportNumbers(a); }],
  ["an enum", count => { const a: Kind[] = []; return pushKinds(a, count) + " " + reportNumbers(a); }],
  ["objects", count => { const a: Item[] = []; return pushItems(a, count) + " " + reportAnything(a); }],
  ["texts", count => { const a: string[] = []; return pushTexts(a, count) + " " + reportAnything(a); }],
  ["a mixture", count => { const a: unknown[] = []; return pushAnything(a, count) + " " + reportAnything(a); }],
  ["whole numbers into unknown[]", count => { const a: unknown[] = []; return pushWholeAsAnything(a, count) + " " + reportAnything(a); }],
  ["pairs", count => { const a: number[] = []; return pushPairs(a, count) + " " + reportNumbers(a); }],
  ["triples", count => { const a: number[] = []; return pushTriples(a, count) + " " + reportNumbers(a); }],
  ["fractions, the result unused", count => { const a: number[] = []; return pushWithoutResult(a, count) + " " + reportNumbers(a); }],
  ["whole numbers appended", count => { const a: number[] = []; return appendWhole(a, count) + " " + reportNumbers(a); }],
  ["fractions appended", count => { const a: number[] = []; return appendFractions(a, count) + " " + reportNumbers(a); }],
  ["whole numbers, built and returned", count => reportNumbers(buildWhole(count))],
  ["fractions, built and returned", count => reportNumbers(buildFractions(count))],
  ["fractions, built in a loop without a count", count => reportNumbers(buildWhile(count))],
];
for (const [what, run] of intoEmpty) console.log(what + ": " + counts.map(run).join(" ; "));

// Arrays that are something already when the pushes begin. Most hold three elements.
function literalOfWhole(): number[] {
  return [1, 2, 3];
}

function literalOfFractions(): number[] {
  return [0.5, 1.5, 2.5];
}

function changed(a: number[], change: (a: number[]) => void): number[] {
  change(a);
  return a;
}

function withNames(a: number[], names: number): number[] {
  for (let i = 0; i < names; i++) (a as unknown as Record<string, number>)["name" + i] = i + 0.5;
  return a;
}

function namesOf(a: number[]): string {
  let text = "";
  for (const key of Object.keys(a)) if (key.startsWith("name")) text += " " + key + "=" + (a as unknown as Record<string, number>)[key];
  return text;
}

class Numbers extends Array<number> {}

const starts: [string, () => number[]][] = [
  ["a literal of whole numbers", literalOfWhole],
  ["a literal of fractions", literalOfFractions],
  ["parsed whole numbers", () => JSON.parse("[1,2,3]") as number[]],
  ["parsed fractions", () => JSON.parse("[0.5,1.5,2.5]") as number[]],
  ["a slice", () => [0, 1, 2, 3, 4].slice(1, 4)],
  ["a map", () => literalOfWhole().map(value => value + 0.5)],
  ["Array.from", () => Array.from({ length: 3 }, (_, i) => i)],
  ["new Array(3), filled", () => new Array<number>(3).fill(7)],
  ["new Array(3)", () => new Array<number>(3)],
  ["new Array(200), emptied", () => changed(new Array<number>(200), a => (a.length = 0))],
  ["grown to 300, emptied", () => changed(buildFractions(300), a => (a.length = 0))],
  ["grown to 300, cut to 3", () => changed(buildWhole(300), a => (a.length = 3))],
  ["grown to 70, popped to 3", () => changed(buildFractions(70), a => { while (a.length > 3) a.pop(); })],
  ["a hole", () => [1, , 3] as number[]],
  ["a hole among fractions", () => [0.5, , 2.5] as number[]],
  ["held a text once", () => changed(["x", 2, 3] as unknown[] as number[], a => (a[0] = 1))],
  ["one name", () => withNames(literalOfWhole(), 1)],
  ["one name, fractions", () => withNames(literalOfFractions(), 1)],
  ["five names", () => withNames(literalOfWhole(), 5)],
  ["twenty names", () => withNames(literalOfFractions(), 20)],
  ["one name on an empty array", () => withNames([], 1)],
  ["a subclass", () => changed(new Numbers(), a => a.push(1, 2, 3))],
  ["was sparse", () => changed(literalOfWhole(), a => ((a[1000000] = 1), (a.length = 3)))],
  ["another prototype", () => changed(literalOfFractions(), a => Object.setPrototypeOf(a, { __proto__: Array.prototype }))],
];
const countsFromThree = [0, 1, 2, 3, 4, 5, 28, 29, 60, 61, 62, 63, 93, 94, 95, 1020, 1021, 1022, 1023];
const longCountsFromThree = [99996, 99997, 99998];
console.log("counts from three: " + countsFromThree.join(" ") + ", and for fractions " + longCountsFromThree.join(" "));
const ontoStarts: [string, (a: number[], count: number) => number][] = [
  ["whole numbers", pushWhole],
  ["fractions", pushFractions],
  ["pairs", pushPairs],
  ["fractions appended", appendFractions],
];
for (const [name, make] of starts) {
  for (const [what, run] of ontoStarts) {
    console.log(name + ", " + what + ": " + (run === pushFractions ? [...countsFromThree, ...longCountsFromThree] : countsFromThree).map(count => { const a = make(); return run(a, count) + " " + reportNumbers(a) + namesOf(a); }).join(" ; "));
  }
}
console.log("the literals afterwards: " + reportNumbers(literalOfWhole()) + " " + reportNumbers(literalOfFractions()));

// NaN, and other numbers that are not like the rest, at the end.
for (const count of [0, 1, 2, 3, 63, 64, 65, 1023, 1024, 99999, 100000, 100001]) {
  console.log("at the end of " + count + ": " + [nan, -0, Infinity, 2147483648, 0.5, 1].map(value => {
    const fractions = buildFractions(count), whole = buildWhole(count), kinds = buildKinds(count);
    const lengths = pushOne(fractions, value) + " " + pushOne(fractions, 8.5) + " " + pushOne(fractions, value) + " " + pushOne(whole, value) + " " + pushOne(whole, 8) + " " + pushOne(whole, value) + " " + pushOneKind(kinds, value as Kind) + " " + pushOneKind(kinds, Kind.Mark) + " " + pushOneKind(kinds, value as Kind);
    return lengths + " " + reportNumbers(fractions) + " " + reportNumbers(whole) + " " + reportNumbers(kinds) + " " + show(fractions[count]) + " " + show(whole[count + 2]) + " " + show(kinds[count]) + " " + show(kinds[count + 1]) + " " + fractions.includes(value) + " " + whole.indexOf(value) + " " + whole.lastIndexOf(value) + " " + kinds.lastIndexOf(value as Kind);
  }).join(" ; "));
}
console.log("what is no number, at the end: " + [undefined, null, "t5", { id: 1 }].map(value => {
  const fractions = buildFractions(64), whole = buildWhole(1024);
  return pushOne(fractions, value as unknown as number) + " " + pushOne(fractions, 1.5) + " " + pushOne(whole, value as unknown as number) + " " + pushOne(whole, 1) + " " + reportAnything(fractions) + " " + reportAnything(whole) + " " + typeof fractions[64] + " " + typeof whole[1024];
}).join(" ; "));

// Names are added while the array grows.
function pushAndName(a: number[], count: number, fraction: number): number {
  let last = -1;
  for (let i = 0; i < count; i++) {
    if (i === 2 || i === 10 || i === 64 || i === 65 || i === 100 || i === 1000 || i === 1024 || i === 10000 || i === 99999) (a as unknown as Record<string, number>)["name" + i] = i;
    last = a.push(i + fraction);
  }
  return last;
}
for (const count of [3, 11, 66, 101, 1030, 10010, 100010]) {
  console.log("names on the way to " + count + ": " + [0, 0.5].map(fraction => { const a: number[] = []; return pushAndName(a, count, fraction) + " " + reportNumbers(a) + namesOf(a); }).join(" ; "));
}

// Two arrays grow in turns, and an array takes its own length.
function pushInTurns(a: number[], b: number[], count: number): number {
  let last = 0;
  for (let i = 0; i < count; i++) last += a.push(i + 0.5) - b.push(i);
  return last;
}
function pushOwnLength(a: number[], count: number): number {
  let last = -1;
  for (let i = 0; i < count; i++) last = a.push(a.length);
  return last;
}
function pushAndPop(a: number[], count: number): number {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    a.push(i + 0.5);
    a.push(i + 1.5);
    sum += a.pop()!;
  }
  return sum;
}
for (const count of [5, 64, 65, 1025, 100001]) {
  const a: number[] = [], b: number[] = [], c: number[] = [], d: number[] = [];
  console.log("in turns, " + count + ": " + pushInTurns(a, b, count) + " " + reportNumbers(a) + " " + reportNumbers(b) + " ; " + pushOwnLength(c, count) + " " + reportNumbers(c) + " ; " + pushAndPop(d, count) + " " + reportNumbers(d));
}
const same: number[] = [];
console.log("one array under two names: " + pushInTurns(same, same, 70) + " " + reportNumbers(same));

// The collector has seen the array before, and has not seen what is pushed.
function checkItems(a: Item[]): string {
  let wrong = 0, sum = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== i) wrong++;
    sum += a[i].id;
  }
  return a.length + "/" + sum + "/" + wrong + " wrong";
}
function checkTexts(a: string[]): string {
  let wrong = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== "t" + i) wrong++;
  return a.length + "/" + wrong + " wrong";
}
function churn(): number {
  let kept: number[][] = [];
  for (let i = 0; i < 2000; i++) {
    kept.push([i, i + 1, i + 2, i + 3]);
    if (kept.length > 50) kept = [];
  }
  return kept.length;
}
function pushItemsFrom(a: Item[], from: number, to: number): void {
  for (let i = from; i < to; i++) a.push({ id: i });
}
function pushTextsFrom(a: string[], from: number, to: number): void {
  for (let i = from; i < to; i++) a.push("t" + i);
}
{
  const items: Item[] = [], texts: string[] = [];
  let from = 0;
  for (const to of [3, 60, 64, 65, 70, 97, 150, 1000, 1024, 1025, 1600, 5000, 60000, 99999, 100000, 100001, 120000]) {
    pushItemsFrom(items, from, to);
    pushTextsFrom(texts, from, to);
    from = to;
    collect(to % 2 === 0);
    churn();
    console.log("collected at " + to + ": " + checkItems(items) + " " + checkTexts(texts));
  }
  collect(true);
  console.log("collected at the end: " + checkItems(items) + " " + checkTexts(texts));
}
{
  const old: Item[] = [];
  pushItemsFrom(old, 0, 64);
  collect(true);
  collect(true);
  for (let round = 0; round < 12; round++) {
    pushItemsFrom(old, old.length, old.length + 40 + round * 100);
    collect(false);
    churn();
  }
  console.log("an old array, young objects: " + checkItems(old));
}

// Arrays that refuse, and what a prototype has ahead.
const refusing: [string, () => number[]][] = [
  ["frozen", () => changed(literalOfWhole(), a => Object.freeze(a))],
  ["sealed", () => changed(literalOfFractions(), a => Object.seal(a))],
  ["not extensible", () => changed(literalOfWhole(), a => Object.preventExtensions(a))],
  ["not extensible, with room", () => changed(buildFractions(70), a => ((a.length = 3), Object.preventExtensions(a)))],
  ["a length that is read-only", () => changed(literalOfWhole(), a => Object.defineProperty(a, "length", { writable: false }))],
  ["a setter at 5 on the prototype", () => changed(literalOfWhole(), a => Object.setPrototypeOf(a, { __proto__: Array.prototype, set 5(value: number) { events += " set 5 to " + value; } }))],
  ["a setter at 70 on the prototype", () => changed(literalOfFractions(), a => Object.setPrototypeOf(a, { __proto__: Array.prototype, set 70(value: number) { events += " set 70 to " + value; } }))],
  ["a read-only 5 on the prototype", () => changed(literalOfWhole(), a => Object.setPrototypeOf(a, Object.defineProperty({ __proto__: Array.prototype }, 5, { value: 50, writable: false })))],
  ["a plain 5 on the prototype", () => changed(literalOfWhole(), a => Object.setPrototypeOf(a, { __proto__: Array.prototype, 5: 50 }))],
];
for (const [name, make] of refusing) {
  console.log(name + ": " + [1, 4, 100].map(count => {
    const a = make();
    const pushed = attempt(() => String(pushFractions(a, count)));
    let own = 0;
    for (let i = 0; i < a.length; i++) if (Object.hasOwn(a, i)) own++;
    return pushed + " " + a.length + " long, " + own + " own, " + show(a[5]) + " " + show(a[a.length - 1]);
  }).join(" ; "));
}
for (const length of [4294967293, 4294967294, 4294967295]) {
  const a: number[] = [];
  a.length = length;
  console.log("from the length " + length + ": " + attempt(() => String(pushOne(a, 1.5))) + " " + attempt(() => String(pushOne(a, 2.5))) + " " + a.length + " " + Object.keys(a).join());
}
