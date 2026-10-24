// In the middle of a typed loop over a `number[]` the array takes what its storage cannot hold, or loses what the loop counts on: NaN, undefined, null, a text, an object, a hole made by `delete`, `length = 0`, an element stored far past the end, a method of the library that moves the elements, a frozen array, a getter, another prototype, a named property. The change is written in the body of the loop, or made by a function the loop calls by name, or by a function value. The loops go on as in plain Bun: what they add up (a sum, and bits that NaN does not swallow), what they store and what the array holds afterwards. At the end come arrays that only typed code ever sees.
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function list(a: unknown[]): string {
  let text = "[";
  for (let i = 0; i < a.length; i++) text += (i > 0 ? " " : "") + (Object.hasOwn(a, i) ? show(a[i]) : "hole");
  text += "]";
  for (const key of Object.keys(a)) if (String(Number(key) >>> 0) !== key) text += " " + key + "=" + show((a as unknown as Record<string, unknown>)[key]);
  return text;
}

function outcome(a: number[], run: (a: number[]) => string): string {
  let text: string;
  try {
    text = run(a);
  } catch (error) {
    text = "threw " + (error as Error).constructor.name;
  }
  return text + " " + list(a);
}

const nan = Number(JSON.parse('"x"'));
const four = JSON.parse("4") as number;

const makers: [string, () => number[]][] = [
  ["whole numbers", () => [1, 2, 3, 4, 5, 6]],
  ["fractions", () => [0.5, 1.5, 2.5, 3.5, 4.5, 5.5]],
  ["parsed whole numbers", () => JSON.parse("[1,2,3,4,5,6]") as number[]],
  ["pushed", () => {
    const a: number[] = [];
    for (let i = 1; i <= 6; i++) a.push(i);
    return a;
  }],
  ["held a text once", () => {
    const a: unknown[] = ["x", 2, 3, 4, 5, 6];
    a[0] = 1;
    return a as number[];
  }],
];
const moments = [0, 2, 4, 5];

// The change is in the body of the loop, one kind of change to a loop.
function numberStoredInBody(a: number[], when: number, v: number): string {
  let total = 0, bits = 0;
  for (let i = 0; i < a.length; i++) {
    if (i === when) a[i + 1] = v;
    total += a[i];
    bits = (bits << 1) ^ (a[i] * 4);
  }
  return show(total) + " " + bits;
}

function numberStoredBehindInBody(a: number[], when: number, v: number): string {
  let total = 0, bits = 0;
  for (let i = 0; i < a.length; i++) {
    total += a[i];
    bits = (bits << 1) ^ (a[i] * 4);
    if (i === when) a[0] = v;
  }
  for (let i = 0; i < a.length; i++) {
    total += a[i];
    bits = (bits << 1) ^ (a[i] * 4);
  }
  return show(total) + " " + bits;
}

function undefinedStoredInBody(a: number[], when: number): string {
  let total = 0, bits = 0;
  for (let i = 0; i < a.length; i++) {
    if (i === when) a[i + 1] = undefined as any;
    total += a[i];
    bits = (bits << 1) ^ (a[i] * 4);
  }
  return show(total) + " " + bits;
}

function nullStoredInBody(a: number[], when: number): string {
  let total = 0, bits = 0;
  for (let i = 0; i < a.length; i++) {
    if (i === when) a[i + 1] = null as any;
    total += a[i];
    bits = (bits << 1) ^ (a[i] * 4);
  }
  return show(total) + " " + bits;
}

function textStoredInBody(a: number[], when: number): string {
  let total = 0, bits = 0;
  for (let i = 0; i < a.length; i++) {
    if (i === when) a[i + 1] = "text" as any;
    total += a[i];
    bits = (bits << 1) ^ (a[i] * 4);
  }
  return show(total) + " " + bits;
}

function objectStoredInBody(a: number[], when: number): string {
  let total = 0, bits = 0;
  for (let i = 0; i < a.length; i++) {
    if (i === when) a[i + 1] = { valueOf: () => 100 } as any;
    total += a[i];
    bits = (bits << 1) ^ (a[i] * 4);
  }
  return show(total) + " " + bits;
}

function deletedInBody(a: number[], when: number): string {
  let total = 0, bits = 0;
  for (let i = 0; i < a.length; i++) {
    if (i === when) delete a[i + 1];
    total += a[i];
    bits = (bits << 1) ^ (a[i] * 4);
  }
  return show(total) + " " + bits;
}

function emptiedInBody(a: number[], when: number): string {
  let total = 0, bits = 0;
  for (let i = 0; i < a.length; i++) {
    if (i === when) a.length = 0;
    total += a[i];
    bits = (bits << 1) ^ (a[i] * 4);
  }
  return show(total) + " " + bits;
}

function emptiedInBodyUnderAnEarlierLength(a: number[], when: number): string {
  let total = 0, bits = 0;
  for (let i = 0, length = a.length; i < length; i++) {
    if (i === when) a.length = 0;
    total += a[i];
    bits = (bits << 1) ^ (a[i] * 4);
  }
  return show(total) + " " + bits;
}

function shortenedInBody(a: number[], when: number): string {
  let total = 0, bits = 0;
  for (let i = 0; i < a.length; i++) {
    if (i === when) a.length = i + 2;
    total += a[i];
    bits = (bits << 1) ^ (a[i] * 4);
  }
  return show(total) + " " + bits;
}

function lengthenedInBody(a: number[], when: number): string {
  let total = 0, bits = 0;
  for (let i = 0; i < a.length; i++) {
    if (i === when) a.length = a.length + 2;
    total += a[i];
    bits = (bits << 1) ^ (a[i] * 4);
  }
  return show(total) + " " + bits;
}

function storedFarInBody(a: number[], when: number): string {
  let total = 0, bits = 0;
  for (let i = 0; i < a.length; i++) {
    if (i === when) a[a.length + 5] = 1;
    total += a[i];
    bits = (bits << 1) ^ (a[i] * 4);
  }
  return show(total) + " " + bits;
}

function pushedInBody(a: number[], when: number, v: number): string {
  let total = 0, bits = 0;
  for (let i = 0; i < a.length; i++) {
    if (i === when) a.push(v);
    total += a[i];
    bits = (bits << 1) ^ (a[i] * 4);
  }
  return show(total) + " " + bits;
}

function poppedInBody(a: number[], when: number): string {
  let total = 0, bits = 0;
  for (let i = 0; i < a.length; i++) {
    if (i === when) total += a.pop()!;
    total += a[i];
    bits = (bits << 1) ^ (a[i] * 4);
  }
  return show(total) + " " + bits;
}

function undefinedStoredInBodyOfForOf(a: number[], when: number): string {
  let total = 0, bits = 0, i = 0;
  for (const value of a) {
    if (i === when) a[i + 1] = undefined as any;
    total += value;
    bits = (bits << 1) ^ (value * 4);
    i++;
  }
  return show(total) + " " + bits;
}

function numberStoredInBodyOfForOf(a: number[], when: number, v: number): string {
  let total = 0, bits = 0, i = 0;
  for (const value of a) {
    if (i === when) a[i + 1] = v;
    total += value;
    bits = (bits << 1) ^ (value * 4);
    i++;
  }
  return show(total) + " " + bits;
}

function deletedInBodyOfForOf(a: number[], when: number): string {
  let total = 0, bits = 0, i = 0;
  for (const value of a) {
    if (i === when) delete a[i + 1];
    total += value;
    bits = (bits << 1) ^ (value * 4);
    i++;
  }
  return show(total) + " " + bits;
}

function emptiedInBodyOfForOf(a: number[], when: number): string {
  let total = 0, bits = 0, i = 0;
  for (const value of a) {
    if (i === when) a.length = 0;
    total += value;
    bits = (bits << 1) ^ (value * 4);
    i++;
  }
  return show(total) + " " + bits;
}

function everyElementBecomes(a: number[], v: number): string {
  let total = 0, bits = 0;
  for (let i = 0; i < a.length; i++) {
    total += a[i];
    bits = (bits << 1) ^ (a[i] * 4);
    a[i] = v;
  }
  for (let i = 0; i < a.length; i++) {
    total += a[i];
    bits = (bits << 1) ^ (a[i] * 4);
  }
  return show(total) + " " + bits;
}

const inBody: [string, (a: number[], when: number) => string][] = [
  ["NaN stored", (a, when) => numberStoredInBody(a, when, nan)],
  ["-0 stored", (a, when) => numberStoredInBody(a, when, -0)],
  ["a fraction stored", (a, when) => numberStoredInBody(a, when, 0.25)],
  ["2 ** 31 stored", (a, when) => numberStoredInBody(a, when, 2147483648)],
  ["Infinity stored", (a, when) => numberStoredInBody(a, when, Infinity)],
  ["NaN stored behind the loop's position", (a, when) => numberStoredBehindInBody(a, when, nan)],
  ["a fraction stored behind the loop's position", (a, when) => numberStoredBehindInBody(a, when, 0.25)],
  ["undefined stored", undefinedStoredInBody],
  ["null stored", nullStoredInBody],
  ["a text stored", textStoredInBody],
  ["an object stored", objectStoredInBody],
  ["deleted", deletedInBody],
  ["length = 0", emptiedInBody],
  ["length = 0 under an earlier length", emptiedInBodyUnderAnEarlierLength],
  ["a shorter length", shortenedInBody],
  ["a longer length", lengthenedInBody],
  ["stored far past the end", storedFarInBody],
  ["NaN pushed", (a, when) => pushedInBody(a, when, nan)],
  ["a fraction pushed", (a, when) => pushedInBody(a, when, 0.25)],
  ["popped", poppedInBody],
  ["for-of, undefined stored", undefinedStoredInBodyOfForOf],
  ["for-of, NaN stored", (a, when) => numberStoredInBodyOfForOf(a, when, nan)],
  ["for-of, a fraction stored", (a, when) => numberStoredInBodyOfForOf(a, when, 0.25)],
  ["for-of, deleted", deletedInBodyOfForOf],
  ["for-of, length = 0", emptiedInBodyOfForOf],
];
for (const [change, run] of inBody) {
  for (const [name, make] of makers) {
    console.log("in the body, " + change + ", " + name + ": " + moments.map(when => outcome(make(), a => run(a, when))).join(" ; "));
  }
}
for (const [name, make] of makers) {
  console.log("every element becomes, " + name + ": " + [nan, -0, 0.25, 7].map(v => outcome(make(), a => everyElementBecomes(a, v))).join(" ; "));
}

// The change is made by a function that the loop calls by name.
function spoil(a: unknown[], i: number, value: unknown): void {
  a[i] = value;
}

function change(kind: number, a: number[], i: number): void {
  switch (kind) {
    case 0: a[i] = nan; break;
    case 1: a[i] = undefined as any; break;
    case 2: spoil(a, i, "text"); break;
    case 3: delete a[i]; break;
    case 4: a.length = 0; break;
    case 5: a[a.length + 5] = 1; break;
    case 6: spoil(a, i, null); break;
    case 7: a[i] = 0.25; break;
  }
}
const kinds = ["NaN", "undefined", "a text", "delete", "length = 0", "far past the end", "null", "a fraction"];

function sumAroundNamedCall(a: number[], when: number, kind: number): string {
  let total = 0, bits = 0;
  for (let i = 0; i < a.length; i++) {
    if (i === when) change(kind, a, i + 1);
    total += a[i];
    bits = (bits << 1) ^ (a[i] * 4);
  }
  return show(total) + " " + bits;
}

function sumOfAroundNamedCall(a: number[], when: number, kind: number): string {
  let total = 0, bits = 0, i = 0;
  for (const value of a) {
    if (i === when) change(kind, a, i + 1);
    total += value;
    bits = (bits << 1) ^ (value * 4);
    i++;
  }
  return show(total) + " " + bits;
}

function doubleAroundNamedCall(a: number[], when: number, kind: number): string {
  for (let i = 0; i < a.length; i++) {
    if (i === when) change(kind, a, i + 1);
    a[i] = a[i] * 2;
  }
  return String(a.length);
}

function readTwiceAroundNamedCall(a: number[], when: number, kind: number): string {
  const before = a[when + 1];
  change(kind, a, when + 1);
  return show(before + a[when + 1]);
}

const aroundNamedCall: [string, (a: number[], when: number, kind: number) => string][] = [
  ["a sum", sumAroundNamedCall],
  ["a for-of sum", sumOfAroundNamedCall],
  ["doubling", doubleAroundNamedCall],
  ["two reads", readTwiceAroundNamedCall],
];
for (const [loop, run] of aroundNamedCall) {
  for (let kind = 0; kind < kinds.length; kind++) {
    for (const [name, make] of makers) {
      console.log("by a named function, " + loop + ", " + kinds[kind] + ", " + name + ": " + moments.map(when => outcome(make(), a => run(a, when, kind))).join(" ; "));
    }
  }
}

// The change is made by a function value.
type Change = (a: number[], i: number) => void;

function sumAround(a: number[], when: number, act: Change): string {
  let total = 0, bits = 0;
  for (let i = 0; i < a.length; i++) {
    if (i === when) act(a, i + 1);
    total += a[i];
    bits = (bits << 1) ^ (a[i] * 4);
  }
  return show(total) + " " + bits;
}

function sumUnderAnEarlierLength(a: number[], when: number, act: Change): string {
  let total = 0, bits = 0;
  for (let i = 0, length = a.length; i < length; i++) {
    if (i === when) act(a, i + 1);
    total += a[i];
    bits = (bits << 1) ^ (a[i] * 4);
  }
  return show(total) + " " + bits;
}

function sumBackwards(a: number[], when: number, act: Change): string {
  let total = 0, bits = 0;
  for (let i = a.length - 1; i >= 0; i--) {
    if (i === when) act(a, i - 1);
    total += a[i];
    bits = (bits << 1) ^ (a[i] * 4);
  }
  return show(total) + " " + bits;
}

function sumOfAround(a: number[], when: number, act: Change): string {
  let total = 0, bits = 0, i = 0;
  for (const value of a) {
    if (i === when) act(a, i + 1);
    total += value;
    bits = (bits << 1) ^ (value * 4);
    i++;
  }
  return show(total) + " " + bits;
}

function doubleAround(a: number[], when: number, act: Change): string {
  for (let i = 0; i < a.length; i++) {
    if (i === when) act(a, i + 1);
    a[i] = a[i] * 2;
  }
  return String(a.length);
}

function countAround(a: number[], when: number, act: Change): string {
  let larger = 0;
  for (let i = 0; i < a.length; i++) {
    if (i === when) act(a, i + 1);
    if (a[i] > 2) larger++;
    if (a[i] === undefined) larger += 100;
  }
  return String(larger);
}

function mapAround(a: number[], when: number, act: Change): string {
  const mapped = a.map((value, i) => {
    if (i === when) act(a, i + 1);
    return value + 1;
  });
  let total = 0, bits = 0;
  for (let i = 0; i < mapped.length; i++) {
    total += mapped[i];
    bits = (bits << 1) ^ (mapped[i] * 4);
  }
  return show(total) + " " + bits;
}

const loops: [string, (a: number[], when: number, act: Change) => string][] = [
  ["a sum", sumAround],
  ["a sum under an earlier length", sumUnderAnEarlierLength],
  ["a sum backwards", sumBackwards],
  ["a for-of sum", sumOfAround],
  ["doubling", doubleAround],
  ["counting", countAround],
  ["map", mapAround],
];
const changes: [string, Change][] = [
  ["nothing", () => {}],
  ["NaN", (a, i) => { a[i] = nan; }],
  ["undefined", (a, i) => { a[i] = undefined as any; }],
  ["null", (a, i) => { a[i] = null as any; }],
  ["a text", (a, i) => { a[i] = "text" as any; }],
  ["a text through unknown[]", (a, i) => spoil(a, i, "text")],
  ["an object", (a, i) => { a[i] = { valueOf: () => 100 } as any; }],
  ["a bigint", (a, i) => { a[i] = 5n as any; }],
  ["a fraction", (a, i) => { a[i] = 0.25; }],
  ["-0", (a, i) => { a[i] = -0; }],
  ["delete", (a, i) => { delete a[i]; }],
  ["length = 0", a => { a.length = 0; }],
  ["length = 0 and pushes", a => { a.length = 0; a.push(10, 20.5, 30); }],
  ["a longer length", a => { a.length += 3; }],
  ["far past the end", a => { a[a.length + 5] = 1; }],
  ["very far past the end", a => { a[a.length + 200000] = 1; a.length = 8; }],
  ["push NaN", a => { a.push(nan); }],
  ["push a text", a => { a.push("text" as any); }],
  ["pushes until the storage moves", a => { for (let n = 0; n < 40; n++) a.push(n / 2); a.length = 8; }],
  ["pop", a => { a.pop(); }],
  ["shift", a => { a.shift(); }],
  ["unshift", a => { a.unshift(0.25); }],
  ["splice out", (a, i) => { a.splice(i, 1); }],
  ["splice in", (a, i) => { a.splice(i, 0, 0.75, nan); }],
  ["fill NaN", a => { a.fill(nan); }],
  ["fill a fraction", a => { a.fill(0.25); }],
  ["fill undefined", a => { a.fill(undefined as any); }],
  ["reverse", a => { a.reverse(); }],
  ["sort", a => { a.sort((left, right) => right - left); }],
  ["copyWithin", a => { a.copyWithin(0, 3); }],
  ["freeze", a => { Object.freeze(a); }],
  ["seal", a => { Object.seal(a); }],
  ["a getter", (a, i) => { Object.defineProperty(a, i, { get: () => 100, enumerable: true, configurable: true }); }],
  ["a read-only element", (a, i) => { Object.defineProperty(a, i, { value: 100, writable: false, enumerable: true, configurable: true }); }],
  ["a hole over another prototype's element", (a, i) => { delete a[i]; Object.setPrototypeOf(a, { __proto__: Array.prototype, [i]: 1000 }); }],
  ["a hole over another prototype's text", (a, i) => { delete a[i]; Object.setPrototypeOf(a, { __proto__: Array.prototype, [i]: "up" }); }],
  ["a named property", a => { (a as unknown as Record<string, number>).name = 1; }],
  ["five named properties", a => { for (const name of ["p", "q", "r", "s", "t"]) (a as unknown as Record<string, number>)[name] = 1; }],
];
for (const [loop, run] of loops) {
  for (const [what, act] of changes) {
    for (const [name, make] of makers) {
      console.log("by a function value, " + loop + ", " + what + ", " + name + ": " + moments.map(when => outcome(make(), a => run(a, when, act))).join(" ; "));
    }
  }
}

// Arrays that only typed code ever sees: nothing but the functions below reads them, stores into them or prints them. Each group has functions of its own.
function readWhole(a: number[]): string {
  let total = 0, text = "";
  for (let i = 0; i < a.length; i++) {
    total += a[i];
    text += a[i] + ",";
  }
  return total + " " + text;
}
function makeWhole(count: number): number[] {
  const a: number[] = [];
  for (let i = 0; i < count; i++) a.push((i * 5) & 15);
  return a;
}
const wholeLiteral: number[] = [7, 8, 9];
const wholePushed = makeWhole(four + 3);
wholePushed[1] = (four * 3) | 0;
console.log("only whole numbers: " + readWhole(wholeLiteral) + " " + readWhole(wholePushed) + " " + readWhole(makeWhole(0)));

function readBoth(a: number[]): string {
  let total = 0, text = "";
  for (let i = 0; i < a.length; i++) {
    total += a[i];
    text += a[i] + ",";
  }
  return total + " " + text;
}
console.log("whole numbers here, fractions there: " + readBoth([1, 2, 3]) + " " + readBoth([0.5, 1.5]) + " " + readBoth([four, four + 1]) + " " + readBoth([four / 8]));

function readLaterFraction(a: number[]): string {
  let total = 0, text = "";
  for (let i = 0; i < a.length; i++) {
    total += a[i];
    text += a[i] + ",";
  }
  return total + " " + text;
}
function storeLaterFraction(a: number[], i: number, v: number): void {
  a[i] = v;
}
const laterFraction: number[] = [1, 2, 3];
console.log("a fraction later: " + readLaterFraction(laterFraction));
storeLaterFraction(laterFraction, 1, four / 8);
console.log("a fraction later: " + readLaterFraction(laterFraction));

function readLaterNaN(a: number[]): string {
  let total = 0, text = "", present = 0;
  for (let i = 0; i < a.length; i++) {
    total += a[i];
    text += a[i] + ",";
    if (i in a) present++;
  }
  return total + " " + text + " " + present;
}
function storeLaterNaN(a: number[], i: number, v: number): void {
  a[i] = v;
}
const laterNaN: number[] = [0.5, 1.5, 2.5];
console.log("NaN later: " + readLaterNaN(laterNaN));
storeLaterNaN(laterNaN, 1, (four - 4) / (four - 4));
console.log("NaN later: " + readLaterNaN(laterNaN));

function readLaterUndefined(a: number[]): string {
  let total = 0, text = "", present = 0;
  for (let i = 0; i < a.length; i++) {
    total += a[i];
    text += a[i] + ",";
    if (i in a) present++;
  }
  return total + " " + text + " " + present;
}
const laterUndefined: number[] = [0.5, 1.5, 2.5];
console.log("undefined later: " + readLaterUndefined(laterUndefined));
(laterUndefined as (number | undefined)[])[four - 3] = undefined;
console.log("undefined later: " + readLaterUndefined(laterUndefined));

function readLaterHole(a: number[]): string {
  let total = 0, text = "", present = 0;
  for (let i = 0; i < a.length; i++) {
    total += a[i];
    text += a[i] + ",";
    if (i in a) present++;
  }
  return total + " " + text + " " + present;
}
const laterHole: number[] = [0.5, 1.5, 2.5];
console.log("a hole later: " + readLaterHole(laterHole));
delete laterHole[four - 3];
console.log("a hole later: " + readLaterHole(laterHole));

function readLaterLength(a: number[]): string {
  let total = 0, text = "", present = 0;
  for (let i = 0; i < a.length; i++) {
    total += a[i];
    text += a[i] + ",";
    if (i in a) present++;
  }
  return total + " " + text + " " + present;
}
const laterLength: number[] = [1, 2, 3];
console.log("a longer length later: " + readLaterLength(laterLength));
laterLength.length = four + 1;
console.log("a longer length later: " + readLaterLength(laterLength));
laterLength.length = four - 3;
console.log("a shorter length later: " + readLaterLength(laterLength));

function readLaterFarStore(a: number[]): string {
  let total = 0, text = "", present = 0;
  for (let i = 0; i < a.length; i++) {
    total += a[i];
    text += a[i] + ",";
    if (i in a) present++;
  }
  return total + " " + text + " " + present;
}
function storeFar(a: number[], i: number, v: number): void {
  a[i] = v;
}
const laterFarStore: number[] = [1, 2, 3];
console.log("a store past the end later: " + readLaterFarStore(laterFarStore));
storeFar(laterFarStore, four + 1, 6);
console.log("a store past the end later: " + readLaterFarStore(laterFarStore));

function readOfHoles(a: number[]): string {
  let total = 0, text = "", present = 0;
  for (let i = 0; i < a.length; i++) {
    total += a[i];
    text += a[i] + ",";
    if (i in a) present++;
  }
  return total + " " + text + " " + present;
}
const ofHoles = new Array<number>(four);
console.log("made of holes: " + readOfHoles(ofHoles));
for (let i = 0; i < ofHoles.length; i += 2) ofHoles[i] = i + 0.5;
console.log("made of holes: " + readOfHoles(ofHoles));
for (let i = 1; i < ofHoles.length; i += 2) ofHoles[i] = i;
console.log("made of holes: " + readOfHoles(ofHoles));

function readPair(a: number[]): string {
  let total = 0, text = "", present = 0;
  for (let i = 0; i < a.length; i++) {
    total += a[i];
    text += a[i] + ",";
    if (i in a) present++;
  }
  return total + " " + text + " " + present;
}
function pairOf(first: number, second: number): number[] {
  return [first, second];
}
console.log("a literal of variables: " + readPair(pairOf(four / 8, four)) + " " + readPair(pairOf((four - 4) / (four - 4), four)) + " " + readPair(pairOf(four, (four - 4) / (four - 4))) + " " + readPair(pairOf(-(four - 4), four - 4)));

function readPushed(a: number[]): string {
  let total = 0, text = "", present = 0;
  for (let i = 0; i < a.length; i++) {
    total += a[i];
    text += a[i] + ",";
    if (i in a) present++;
  }
  return total + " " + text + " " + present;
}
function pushOnto(a: number[], v: number): number {
  return a.push(v);
}
const laterPushed: number[] = [0.5];
console.log("NaN pushed later: " + pushOnto(laterPushed, four / 8) + " " + readPushed(laterPushed));
console.log("NaN pushed later: " + pushOnto(laterPushed, (four - 4) / (four - 4)) + " " + readPushed(laterPushed));
console.log("NaN pushed later: " + pushOnto(laterPushed, four) + " " + readPushed(laterPushed));

function readLaterText(a: number[]): string {
  let total = 0, text = "", present = 0;
  for (let i = 0; i < a.length; i++) {
    total += a[i];
    text += a[i] + ",";
    if (i in a) present++;
  }
  return total + " " + text + " " + present;
}
function storeAnything(a: unknown[], i: number, value: unknown): void {
  a[i] = value;
}
const laterText: number[] = [0.5, 1.5, 2.5];
console.log("a text later, without a cast: " + readLaterText(laterText));
storeAnything(laterText, four - 3, "text");
console.log("a text later, without a cast: " + readLaterText(laterText));
