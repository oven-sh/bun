// Typed code reads and stores elements of typed arrays outside of them: at the length and past it, at -1, at fractions, NaN, 2 ** 32 and Infinity; on an empty view, a detached buffer, a view that tracks the length of a resizable buffer, a view of fixed length that a resizable buffer no longer covers, a growable shared buffer, a subclass, a view whose prototype has properties named like those keys. A read outside gives undefined whatever the prototypes hold, a store outside converts its value and does nothing else. In loops a callee shrinks, grows or transfers the buffer, or looks at the buffer of a small view, which moves its elements. Every kind of element takes part: what Uint8ClampedArray rounds, NaN in Float64Array with any bits, what BigInt64Array wraps and refuses.
// STATISTIC: ElementPresenceTestsPlaced >= 10
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function listView(view: ArrayLike<unknown>): string {
  const shown = Math.min(view.length, 12);
  let text = "[";
  for (let i = 0; i < shown; i++) text += (i > 0 ? " " : "") + show(view[i]);
  if (view.length > shown) {
    let sum = 0;
    for (let i = shown; i < view.length; i++) sum = (sum * 31 + Number(view[i])) % 1000003;
    text += " .. " + view.length + " long, " + sum;
  }
  text += "]";
  for (const key of Object.keys(view)) if (String(Number(key) >>> 0) !== key) text += " " + key + "=" + show((view as unknown as Record<string, unknown>)[key]);
  return text;
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

// "NaN ; NaN ; NaN ; 1" becomes "NaN*3 ; 1".
function inRuns(parts: string[]): string {
  let text = "";
  for (let i = 0; i < parts.length; ) {
    let end = i + 1;
    while (end < parts.length && parts[end] === parts[i]) end++;
    text += (i > 0 ? " ; " : "") + parts[i] + (end - i > 1 ? "*" + (end - i) : "");
    i = end;
  }
  return text;
}

function twice(run: () => unknown): string {
  return attempt(() => {
    const first = show(run()), second = show(run());
    return first === second ? first : first + " then " + second;
  });
}

// One read of a byte, one use.
function byteAt(b: Uint8Array, k: number): number { return b[k]; }
function bytePlusOne(b: Uint8Array, k: number): number { return b[k] + 1; }
function byteTimesTwo(b: Uint8Array, k: number): number { return b[k] * 2; }
function byteAsInteger(b: Uint8Array, k: number): number { return b[k] | 0; }
function byteShifted(b: Uint8Array, k: number): number { return b[k] << 4; }
function byteBesideText(b: Uint8Array, k: number): string { return "<" + b[k] + ">"; }
function byteIsSmall(b: Uint8Array, k: number): boolean { return b[k] < 3; }
function byteIsNotSmall(b: Uint8Array, k: number): boolean { return !(b[k] < 3); }
function byteEquals(b: Uint8Array, k: number): boolean { return b[k] === 2; }
function byteIsUndefined(b: Uint8Array, k: number): boolean { return b[k] === undefined; }
function byteOrDefault(b: Uint8Array, k: number): number { return b[k] ?? -7; }
function byteOrOther(b: Uint8Array, k: number): number { return b[k] || -8; }
function byteIsTruthy(b: Uint8Array, k: number): string { return b[k] ? "yes" : "no"; }
function byteTypeName(b: Uint8Array, k: number): string { return typeof b[k]; }
function byteHandedOn(b: Uint8Array, k: number): string { return show(b[k]); }
function byteChased(b: Uint8Array, k: number): number { k = b[k]; k = b[k]; k = b[k]; return k; }
function byteIsThere(b: Uint8Array, k: number): boolean { return k in b; }
function twoBytes(b: Uint8Array, k: number): number { return b[k] + b[k + 1]; }
function fourBytes(b: Uint8Array, k: number): number { return b[k] | (b[k + 1] << 8) | (b[k + 2] << 16) | (b[k + 3] << 24); }
function byteBelowLength(b: Uint8Array, k: number): number { return k < b.length ? b[k] : -1; }
function byteInside(b: Uint8Array, k: number): number { return k >= 0 && k < b.length ? b[k] + 1 : -1; }
function byteIntoArray(b: Uint8Array, k: number): string { const kept: number[] = [0.5]; kept[0] = b[k]; kept.push(b[k]); return listView(kept); }

const byteUses: [string, (b: Uint8Array, k: number) => unknown][] = [
  ["returned", byteAt], ["+ 1", bytePlusOne], ["* 2", byteTimesTwo], ["| 0", byteAsInteger], ["<< 4", byteShifted], ["beside a text", byteBesideText],
  ["< 3", byteIsSmall], ["!(< 3)", byteIsNotSmall], ["=== 2", byteEquals], ["=== undefined", byteIsUndefined], ["?? -7", byteOrDefault], ["|| -8", byteOrOther], ["? :", byteIsTruthy], ["typeof", byteTypeName],
  ["handed on", byteHandedOn], ["chased", byteChased], ["in", byteIsThere], ["two bytes", twoBytes], ["four bytes", fourBytes], ["below the length, then read", byteBelowLength], ["inside, then read", byteInside], ["into an array", byteIntoArray],
];

// One store of a byte.
function putByte(b: Uint8Array, k: number, v: number): void { b[k] = v; }
function putByteForItsValue(b: Uint8Array, k: number, v: number): number { return (b[k] = v); }
function bumpByte(b: Uint8Array, k: number, v: number): number { return v + b[k]++; }
function addToByte(b: Uint8Array, k: number, v: number): number { return (b[k] += v); }
function putByteThenRead(b: Uint8Array, k: number, v: number): number { b[k] = v; return b[k]; }

const byteStores: [string, (b: Uint8Array, k: number, v: number) => unknown][] = [
  ["stored", putByte], ["stored for its value", putByteForItsValue], ["++", bumpByte], ["+=", addToByte], ["stored, then read", putByteThenRead],
];

function fillUp<V extends Uint8Array>(view: V): V {
  const bytes: Uint8Array = view;
  for (let i = 0; i < bytes.length; i++) bytes[i] = i < 3 ? i + 1 : i + 6;
  return view;
}

function resizable(byteLength: number): ArrayBuffer {
  return new ArrayBuffer(byteLength, { maxByteLength: 16 });
}

function changed<V>(view: V, change: (view: V) => void): V {
  change(view);
  return view;
}

class Bytes extends Uint8Array {}
class NamedBytes extends Uint8Array {
  name = "named";
}

const oddNames = { "-1": "minus one", "1.5": "one and a half", "-0": "minus zero", NaN: "not a number", Infinity: "endless", "-Infinity": "endless too", "4294967296": "large", "4294967295": "nearly as large", "1e+21": "huge", 4: "four", 9: "nine", "1.0": "one point zero", "01": "zero one" };

const byteViews: [string, () => Uint8Array][] = [
  ["small", () => fillUp(new Uint8Array(4))],
  ["from a list", () => new Uint8Array([1, 2, 3, 9])],
  ["large", () => fillUp(new Uint8Array(1200))],
  ["small, its buffer seen", () => changed(fillUp(new Uint8Array(4)), view => void view.buffer)],
  ["over a buffer", () => fillUp(new Uint8Array(new ArrayBuffer(4)))],
  ["part of a buffer", () => fillUp(new Uint8Array(new ArrayBuffer(8), 2, 4))],
  ["a subarray", () => fillUp(new Uint8Array(8).fill(99).subarray(2, 6))],
  ["empty", () => new Uint8Array(0)],
  ["an empty part of a buffer", () => new Uint8Array(new ArrayBuffer(8), 8)],
  ["detached", () => changed(fillUp(new Uint8Array(4)), view => void (view.buffer as ArrayBuffer).transfer())],
  ["tracking a resizable buffer", () => fillUp(new Uint8Array(resizable(4)))],
  ["tracking a resizable buffer from 2", () => fillUp(new Uint8Array(resizable(6), 2))],
  ["4 bytes of a resizable buffer", () => fillUp(new Uint8Array(resizable(8), 2, 4))],
  ["tracking a buffer that shrank", () => changed(fillUp(new Uint8Array(resizable(8))), view => (view.buffer as ArrayBuffer).resize(4))],
  ["tracking a buffer that grew", () => changed(fillUp(new Uint8Array(resizable(2))), view => (view.buffer as ArrayBuffer).resize(4))],
  ["tracking from 2 a buffer that shrank to 1", () => changed(fillUp(new Uint8Array(resizable(6), 2)), view => (view.buffer as ArrayBuffer).resize(1))],
  ["4 bytes of a buffer that shrank under them", () => changed(fillUp(new Uint8Array(resizable(8), 2, 4)), view => (view.buffer as ArrayBuffer).resize(5))],
  ["4 bytes of a buffer that shrank and grew again", () => changed(fillUp(new Uint8Array(resizable(8), 2, 4)), view => ((view.buffer as ArrayBuffer).resize(3), (view.buffer as ArrayBuffer).resize(8)))],
  ["over a shared buffer", () => fillUp(new Uint8Array(new SharedArrayBuffer(4)))],
  ["tracking a growable shared buffer", () => fillUp(new Uint8Array(new SharedArrayBuffer(4, { maxByteLength: 16 })))],
  ["a subclass", () => fillUp(new Bytes(4))],
  ["a subclass with a field", () => fillUp(new NamedBytes(4))],
  ["odd names on another prototype", () => changed(fillUp(new Uint8Array(4)), view => Object.setPrototypeOf(view, { __proto__: Uint8Array.prototype, ...oddNames }))],
  ["an own name", () => changed(fillUp(new Uint8Array(4)), view => ((view as unknown as Record<string, unknown>).label = "own"))],
  ["a proxy", () => new Proxy(fillUp(new Uint8Array(4)), {})],
];

const keys = [0, 1, 3, 4, 5, 9, -1, 0.5, 1.5, -0, NaN, 4294967296, 4294967295, 2147483648, -2147483648, Infinity, -Infinity, 1e21];
const keysToStoreAt = [0, 3, 4, 9, -1, 1.5, -0, NaN, 4294967296, Infinity];
console.log("keys: " + keys.map(show).join(" "));
console.log("keys to store at: " + keysToStoreAt.map(show).join(" "));

for (const [name, make] of byteViews) {
  for (const [use, run] of byteUses) {
    const view = make();
    console.log(name + " | " + use + ": " + inRuns(keys.map(k => twice(() => run(view, k)))));
  }
  for (const [use, run] of byteStores) {
    console.log(name + " | " + use + ": " + inRuns(keysToStoreAt.map(k => {
      const view = make();
      return attempt(() => show(run(view, k, 300))) + " " + attempt(() => listView(view));
    })));
  }
}

// Keys that are texts, handed to the same functions.
const textKeys = ["0", "1", "4", "-1", "-0", "1.5", "1.0", "01", "1e0", "NaN", "Infinity", "4294967296", " 1", "", "length", "label"];
console.log("text keys: " + textKeys.map(show).join(" "));
for (const name of ["small", "empty", "detached", "tracking a resizable buffer", "odd names on another prototype", "an own name"]) {
  const make = byteViews.find(entry => entry[0] === name)![1];
  const view = make();
  console.log(name + " | returned: " + inRuns(textKeys.map(k => twice(() => byteAt(view, k as unknown as number)))));
  console.log(name + " | in: " + inRuns(textKeys.map(k => twice(() => byteIsThere(view, k as unknown as number)))));
  console.log(name + " | stored: " + textKeys.filter(k => k !== "length").map(k => {
    const stored = make();
    return attempt(() => show(putByteForItsValue(stored, k as unknown as number, 77))) + " " + attempt(() => listView(stored));
  }).join(" ; "));
}

// A store converts its value, once, wherever it goes.
const counted = { valueOf() { events += " valueOf"; return 65; } } as unknown as number;
console.log("an object stored: " + [0, 4, -1, 1.5, NaN].map(k => { const view = fillUp(new Uint8Array(4)); return attempt(() => typeof putByteForItsValue(view, k, counted)) + " " + listView(view); }).join(" ; "));
console.log("an object stored into a detached view: " + [0, 4].map(k => { const view = fillUp(new Uint8Array(4)); (view.buffer as ArrayBuffer).transfer(); return attempt(() => typeof putByteForItsValue(view, k, counted)) + " " + listView(view); }).join(" ; "));
console.log("a value that detaches the view: " + [0, 3].map(k => {
  const view = fillUp(new Uint8Array(4));
  return attempt(() => typeof putByteForItsValue(view, k, { valueOf() { (view.buffer as ArrayBuffer).transfer(); return 65; } } as unknown as number)) + " " + listView(view);
}).join(" ; "));
console.log("a value that shrinks the buffer: " + [0, 3].map(k => {
  const view = fillUp(new Uint8Array(resizable(4)));
  return attempt(() => typeof putByteForItsValue(view, k, { valueOf() { (view.buffer as ArrayBuffer).resize(2); return 65; } } as unknown as number)) + " " + listView(view);
}).join(" ; "));
console.log("other values stored: " + [undefined, null, true, "12", "x", 5n, Symbol.iterator].map(v => { const view = fillUp(new Uint8Array(4)); return attempt(() => show(putByteThenRead(view, 1, v as unknown as number))) + " " + attempt(() => show(putByteThenRead(view, 4, v as unknown as number))) + " " + listView(view); }).join(" ; "));

// Loops that run past the elements.
function sumWithin(b: Uint8Array): string { let total = 0, bits = 0; for (let i = 0; i < b.length; i++) { total += b[i]; bits = (bits << 1) ^ b[i]; } return show(total) + " " + bits; }
function sumOnePast(b: Uint8Array): string { let total = 0, bits = 0; for (let i = 0; i <= b.length; i++) { total += b[i]; bits = (bits << 1) ^ b[i]; } return show(total) + " " + bits; }
function sumFromMinusOne(b: Uint8Array): string { let total = 0, bits = 0; for (let i = -1; i < b.length; i++) { total += b[i]; bits = (bits << 1) ^ b[i]; } return show(total) + " " + bits; }
function sumOfSix(b: Uint8Array): string { let total = 0, bits = 0; for (let i = 0; i < 6; i++) { total += b[i]; bits = (bits << 1) ^ b[i]; } return show(total) + " " + bits; }
function sumByHalves(b: Uint8Array): string { let total = 0, bits = 0; for (let i = 0; i < b.length; i += 0.5) { total += b[i]; bits = (bits << 1) ^ b[i]; } return show(total) + " " + bits; }
function sumBackwards(b: Uint8Array): string { let total = 0, bits = 0; for (let i = b.length; i >= -1; i--) { total += b[i]; bits = (bits << 1) ^ b[i]; } return show(total) + " " + bits; }
function textOnePast(b: Uint8Array): string { let text = ""; for (let i = Math.max(0, b.length - 3); i <= b.length; i++) text += b[i] + ","; return text; }
function countAbsentOfSix(b: Uint8Array): number { let absent = 0; for (let i = 0; i < 6; i++) if (b[i] === undefined) absent++; return absent; }
function sumOfSixWithDefaults(b: Uint8Array): number { let total = 0; for (let i = 0; i < 6; i++) total += b[i] ?? 100; return total; }
function iterated(b: Uint8Array): string { let total = 0, count = 0; for (const byte of b) { total += byte; count++; } return total + " " + count; }
function fillSix(b: Uint8Array): string { for (let i = 0; i < 6; i++) b[i] = i + 100; return listView(b); }
function fillFromMinusTwo(b: Uint8Array): string { for (let i = -2; i <= b.length; i++) b[i] = i + 100; return listView(b); }
function fillByHalves(b: Uint8Array): string { for (let i = 0; i < b.length; i += 0.5) b[i] = i * 2 + 100; return listView(b); }
function moveDown(b: Uint8Array): string { for (let i = 0; i < b.length; i++) b[i] = b[i + 1]; return listView(b); }
function moveUp(b: Uint8Array): string { for (let i = b.length; i > 0; i--) b[i] = b[i - 1]; return listView(b); }
function bumpSix(b: Uint8Array): string { for (let i = 0; i < 6; i++) b[i]++; return listView(b); }

const byteLoops: [string, (b: Uint8Array) => unknown][] = [
  ["sum", sumWithin], ["sum one past", sumOnePast], ["sum from -1", sumFromMinusOne], ["sum of six", sumOfSix], ["sum by halves", sumByHalves], ["sum backwards", sumBackwards], ["text one past", textOnePast],
  ["absent of six", countAbsentOfSix], ["sum of six with defaults", sumOfSixWithDefaults], ["iterated", iterated],
  ["fill six", fillSix], ["fill from -2", fillFromMinusTwo], ["fill by halves", fillByHalves], ["move down", moveDown], ["move up", moveUp], ["bump six", bumpSix],
];
for (const [name, make] of byteViews) {
  for (const [use, run] of byteLoops) {
    const view = make();
    console.log(name + " | " + use + ": " + twice(() => run(view)));
  }
}

// Loops in which a callee changes the view.
type Act = (b: Uint8Array) => void;

function sumAround(b: Uint8Array, when: number, act: Act): string {
  let total = 0, bits = 0;
  for (let i = 0; i < b.length; i++) {
    if (i === when) act(b);
    total += b[i];
    bits = (bits << 1) ^ b[i];
  }
  return show(total) + " " + bits;
}

function sumUnderAnEarlierLength(b: Uint8Array, when: number, act: Act): string {
  let total = 0, bits = 0;
  for (let i = 0, length = b.length; i < length; i++) {
    if (i === when) act(b);
    total += b[i];
    bits = (bits << 1) ^ b[i];
  }
  return show(total) + " " + bits;
}

function textUnderAnEarlierLength(b: Uint8Array, when: number, act: Act): string {
  let text = "";
  for (let i = 0, length = Math.min(b.length, 10); i < length; i++) {
    if (i === when) act(b);
    text += b[i] + ",";
  }
  return text;
}

function fillAround(b: Uint8Array, when: number, act: Act): string {
  for (let i = 0; i < b.length; i++) {
    if (i === when) act(b);
    b[i] = i + 100;
  }
  return String(b.length);
}

function fillUnderAnEarlierLength(b: Uint8Array, when: number, act: Act): string {
  for (let i = 0, length = b.length; i < length; i++) {
    if (i === when) act(b);
    b[i] = i + 100;
  }
  return String(b.length);
}

function doubleUnderAnEarlierLength(b: Uint8Array, when: number, act: Act): string {
  for (let i = 0, length = b.length; i < length; i++) {
    if (i === when) act(b);
    b[i] = b[i] * 2;
  }
  return String(b.length);
}

function iterateAround(b: Uint8Array, when: number, act: Act): string {
  let total = 0, i = 0;
  for (const byte of b) {
    if (i++ === when) act(b);
    total += byte;
  }
  return total + " " + i;
}

function readCallRead(b: Uint8Array, when: number, act: Act): string {
  const before = b[when];
  act(b);
  return show(before) + " " + show(b[when]) + " " + show(b[when] + 1);
}

function storeCallStore(b: Uint8Array, when: number, act: Act): string {
  b[when] = 200;
  act(b);
  b[when + 1] = 201;
  return show(b[when]) + " " + show(b[when + 1]);
}

const loopsAround: [string, (b: Uint8Array, when: number, act: Act) => string][] = [
  ["sum", sumAround], ["sum under an earlier length", sumUnderAnEarlierLength], ["text under an earlier length", textUnderAnEarlierLength],
  ["fill", fillAround], ["fill under an earlier length", fillUnderAnEarlierLength], ["double under an earlier length", doubleUnderAnEarlierLength],
  ["iterate", iterateAround], ["read, call, read", readCallRead], ["store, call, store", storeCallStore],
];

let otherView: Uint8Array = new Uint8Array(0);
const resizes: [string, Act][] = [
  ["shrinks to 5", b => (b.buffer as ArrayBuffer).resize(5)],
  ["shrinks to 3", b => (b.buffer as ArrayBuffer).resize(3)],
  ["shrinks to 0", b => (b.buffer as ArrayBuffer).resize(0)],
  ["grows to 12", b => (b.buffer as ArrayBuffer).resize(12)],
  ["shrinks to 3 and grows to 12", b => ((b.buffer as ArrayBuffer).resize(3), (b.buffer as ArrayBuffer).resize(12))],
];
const acts: [string, Act][] = [
  ["nothing", () => {}],
  ["throws", () => { throw new RangeError("thrown by the callee"); }],
  ["is transferred", b => void (b.buffer as ArrayBuffer).transfer()],
  ["has its buffer seen", b => void b.buffer],
  ["gets a second view", b => { otherView = new Uint8Array(b.buffer); otherView[b.byteOffset + 6] = 77; }],
  ["is filled", b => void b.fill(9)],
  ["gets a name", b => { (b as unknown as Record<string, number>).label = 1; }],
  ["gets another prototype", b => void Object.setPrototypeOf(b, { __proto__: Uint8Array.prototype, 20: "up", "-1": "down" })],
];
const viewsOfFixedBuffers: [string, () => Uint8Array][] = [
  ["small", () => fillUp(new Uint8Array(8))],
  ["large", () => fillUp(new Uint8Array(1200))],
  ["over a buffer", () => fillUp(new Uint8Array(new ArrayBuffer(8)))],
  ["a subclass", () => fillUp(new Bytes(8))],
];
const viewsOfResizableBuffers: [string, () => Uint8Array][] = [
  ["tracking a resizable buffer", () => fillUp(new Uint8Array(resizable(8)))],
  ["tracking a resizable buffer from 2", () => fillUp(new Uint8Array(resizable(10), 2))],
  ["6 bytes of a resizable buffer from 2", () => fillUp(new Uint8Array(resizable(10), 2, 6))],
  ["a subclass that tracks a resizable buffer", () => fillUp(new Bytes(resizable(8)))],
];
for (const [loop, run] of loopsAround) {
  for (const [what, act] of [...acts, ...resizes]) {
    for (const [name, make] of resizes.some(entry => entry[1] === act) ? viewsOfResizableBuffers : [...viewsOfFixedBuffers, ...viewsOfResizableBuffers]) {
      console.log(loop + ", " + what + ", " + name + ": " + [0, 2, 6].map(when => {
        const view = make();
        otherView = new Uint8Array(0);
        return attempt(() => run(view, when, act)) + " " + listView(view) + (otherView.length > 0 ? " " + listView(otherView) : "");
      }).join(" ; "));
    }
  }
}

// The other kinds of elements.
function readInt8(v: Int8Array, k: number): number { return v[k]; }
function plusInt8(v: Int8Array, k: number): number { return v[k] + 1; }
function writeInt8(v: Int8Array, k: number, x: number): number { v[k] = x; return v[k]; }
function sumInt8(v: Int8Array, from: number, to: number): string { let total = 0, bits = 0; for (let i = from; i < to; i++) { total += v[i]; bits = (bits << 1) ^ v[i]; } return show(total) + " " + bits; }
function readClamped(v: Uint8ClampedArray, k: number): number { return v[k]; }
function plusClamped(v: Uint8ClampedArray, k: number): number { return v[k] + 1; }
function writeClamped(v: Uint8ClampedArray, k: number, x: number): number { v[k] = x; return v[k]; }
function sumClamped(v: Uint8ClampedArray, from: number, to: number): string { let total = 0, bits = 0; for (let i = from; i < to; i++) { total += v[i]; bits = (bits << 1) ^ v[i]; } return show(total) + " " + bits; }
function readInt16(v: Int16Array, k: number): number { return v[k]; }
function plusInt16(v: Int16Array, k: number): number { return v[k] + 1; }
function writeInt16(v: Int16Array, k: number, x: number): number { v[k] = x; return v[k]; }
function sumInt16(v: Int16Array, from: number, to: number): string { let total = 0, bits = 0; for (let i = from; i < to; i++) { total += v[i]; bits = (bits << 1) ^ v[i]; } return show(total) + " " + bits; }
function readUint16(v: Uint16Array, k: number): number { return v[k]; }
function plusUint16(v: Uint16Array, k: number): number { return v[k] + 1; }
function writeUint16(v: Uint16Array, k: number, x: number): number { v[k] = x; return v[k]; }
function sumUint16(v: Uint16Array, from: number, to: number): string { let total = 0, bits = 0; for (let i = from; i < to; i++) { total += v[i]; bits = (bits << 1) ^ v[i]; } return show(total) + " " + bits; }
function readInt32(v: Int32Array, k: number): number { return v[k]; }
function plusInt32(v: Int32Array, k: number): number { return v[k] + 1; }
function writeInt32(v: Int32Array, k: number, x: number): number { v[k] = x; return v[k]; }
function sumInt32(v: Int32Array, from: number, to: number): string { let total = 0, bits = 0; for (let i = from; i < to; i++) { total += v[i]; bits = (bits << 1) ^ v[i]; } return show(total) + " " + bits; }
function readUint32(v: Uint32Array, k: number): number { return v[k]; }
function plusUint32(v: Uint32Array, k: number): number { return v[k] + 1; }
function writeUint32(v: Uint32Array, k: number, x: number): number { v[k] = x; return v[k]; }
function sumUint32(v: Uint32Array, from: number, to: number): string { let total = 0, bits = 0; for (let i = from; i < to; i++) { total += v[i]; bits = (bits << 1) ^ v[i]; } return show(total) + " " + bits; }
function readFloat16(v: Float16Array, k: number): number { return v[k]; }
function plusFloat16(v: Float16Array, k: number): number { return v[k] + 1; }
function writeFloat16(v: Float16Array, k: number, x: number): number { v[k] = x; return v[k]; }
function sumFloat16(v: Float16Array, from: number, to: number): string { let total = 0, bits = 0; for (let i = from; i < to; i++) { total += v[i]; bits = (bits << 1) ^ v[i]; } return show(total) + " " + bits; }
function readFloat32(v: Float32Array, k: number): number { return v[k]; }
function plusFloat32(v: Float32Array, k: number): number { return v[k] + 1; }
function writeFloat32(v: Float32Array, k: number, x: number): number { v[k] = x; return v[k]; }
function sumFloat32(v: Float32Array, from: number, to: number): string { let total = 0, bits = 0; for (let i = from; i < to; i++) { total += v[i]; bits = (bits << 1) ^ v[i]; } return show(total) + " " + bits; }
function readFloat64(v: Float64Array, k: number): number { return v[k]; }
function plusFloat64(v: Float64Array, k: number): number { return v[k] + 1; }
function writeFloat64(v: Float64Array, k: number, x: number): number { v[k] = x; return v[k]; }
function sumFloat64(v: Float64Array, from: number, to: number): string { let total = 0, bits = 0; for (let i = from; i < to; i++) { total += v[i]; bits = (bits << 1) ^ v[i]; } return show(total) + " " + bits; }

const numbersToStore = [7, 127, 128, 255, 256, 300, -1, -129, 0.5, 1.5, 2.5, -0.5, 254.5, 255.5, 0.1, -0, NaN, Infinity, -Infinity, 32768, 65504, 65520, 65536, 2147483647, 2147483648, 4294967295, 4294967301, -2147483649, 1e300, 5e-324];
console.log("numbers to store: " + numbersToStore.map(show).join(" "));

function exercise<V extends ArrayLike<number>>(name: string, make: (buffer?: ArrayBuffer) => V, read: (view: V, k: number) => number, plus: (view: V, k: number) => number, write: (view: V, k: number, x: number) => number, sum: (view: V, from: number, to: number) => string): void {
  const view = make();
  for (let i = 0; i < 4; i++) write(view, i, i * 3 - 2);
  console.log(name + " | returned: " + inRuns(keys.map(k => twice(() => read(view, k)))));
  console.log(name + " | + 1: " + inRuns(keys.map(k => twice(() => plus(view, k)))));
  console.log(name + " | sums: " + [[0, 4], [0, 5], [-1, 4], [2, 8], [4, 6], [0.5, 3]].map(([from, to]) => sum(view, from, to)).join(" ; "));
  console.log(name + " | stored inside: " + numbersToStore.map(x => show(write(view, 1, x))).join(" "));
  console.log(name + " | stored outside: " + inRuns(numbersToStore.map(x => show(write(view, 4, x)))) + " ; " + inRuns(keysToStoreAt.slice(2).map(k => show(write(view, k, 5)))) + " " + listView(view));
  const buffer = resizable(16);
  const tracking = make(buffer);
  for (let i = 0; i < tracking.length; i++) write(tracking, i, i + 1);
  const before = sum(tracking, 0, tracking.length + 1);
  const length = tracking.length;
  buffer.resize(8);
  console.log(name + " | tracking a buffer that shrinks: " + length + " " + before + " ; " + tracking.length + " " + sum(tracking, 0, length) + " " + show(read(tracking, length - 1)) + " " + show(write(tracking, length - 1, 9)) + " " + listView(tracking));
  buffer.transfer();
  console.log(name + " | detached: " + tracking.length + " " + sum(tracking, 0, 2) + " " + show(read(tracking, 0)) + " " + show(write(tracking, 0, 9)) + " " + listView(tracking));
}

exercise("Int8Array", buffer => (buffer ? new Int8Array(buffer) : new Int8Array(4)), readInt8, plusInt8, writeInt8, sumInt8);
exercise("Uint8ClampedArray", buffer => (buffer ? new Uint8ClampedArray(buffer) : new Uint8ClampedArray(4)), readClamped, plusClamped, writeClamped, sumClamped);
exercise("Int16Array", buffer => (buffer ? new Int16Array(buffer) : new Int16Array(4)), readInt16, plusInt16, writeInt16, sumInt16);
exercise("Uint16Array", buffer => (buffer ? new Uint16Array(buffer) : new Uint16Array(4)), readUint16, plusUint16, writeUint16, sumUint16);
exercise("Int32Array", buffer => (buffer ? new Int32Array(buffer) : new Int32Array(4)), readInt32, plusInt32, writeInt32, sumInt32);
exercise("Uint32Array", buffer => (buffer ? new Uint32Array(buffer) : new Uint32Array(4)), readUint32, plusUint32, writeUint32, sumUint32);
exercise("Float16Array", buffer => (buffer ? new Float16Array(buffer) : new Float16Array(4)), readFloat16, plusFloat16, writeFloat16, sumFloat16);
exercise("Float32Array", buffer => (buffer ? new Float32Array(buffer) : new Float32Array(4)), readFloat32, plusFloat32, writeFloat32, sumFloat32);
exercise("Float64Array", buffer => (buffer ? new Float64Array(buffer) : new Float64Array(4)), readFloat64, plusFloat64, writeFloat64, sumFloat64);

// NaN with any bits is one NaN as soon as it leaves the view.
const words = new Uint32Array(2), doubles = new Float64Array(words.buffer);
const halfWords = new Uint32Array(1), floats = new Float32Array(halfWords.buffer);
function keepDouble(v: Float64Array, kept: number[], anything: unknown[], holder: { value: number }): string {
  kept[0] = v[0];
  kept.push(v[0]);
  anything[0] = v[0];
  holder.value = v[0];
  const value = v[0];
  return show(value) + " " + (value !== value) + " " + Object.is(value, NaN) + " " + show(value + 1) + " " + show(value | 0) + " " + typeof value + " " + show(Math.max(value, 1)) + " " + String(value);
}
function keepFloat(v: Float32Array, kept: number[], anything: unknown[]): string {
  kept[0] = v[0];
  kept.push(v[0]);
  anything[0] = v[0];
  return show(v[0]) + " " + (v[0] !== v[0]);
}
for (const [high, low] of [[0x7ff80000, 0], [0xfff80000, 0], [0x7ff00000, 1], [0xfff00000, 1], [0x7ff80000, 1], [0xfffe0000, 42], [0xfffe0000, 0], [0xffff0000, 7], [0xffffffff, 0xffffffff], [0x7fffffff, 0xffffffff], [0xfffc0000, 2], [0x7ff00000, 0], [0xfff00000, 0]]) {
  words[0] = low;
  words[1] = high;
  const kept: number[] = [0.5], anything: unknown[] = [], holder = { value: 0.5 };
  console.log("double " + high.toString(16) + " " + low.toString(16) + ": " + keepDouble(doubles, kept, anything, holder) + " " + listView(kept) + " " + (0 in kept) + " " + (1 in kept) + " " + kept.includes(NaN) + " " + kept.indexOf(NaN) + " " + listView(anything) + " " + show(holder.value) + " " + show(readFloat64(doubles, 0)) + " " + show(readFloat64(doubles, 1)));
}
for (const bits of [0x7fc00000, 0xffc00000, 0x7f800001, 0xff800001, 0xffffffff, 0x7f800000]) {
  halfWords[0] = bits;
  const kept: number[] = [0.5], anything: unknown[] = [];
  console.log("float " + bits.toString(16) + ": " + keepFloat(floats, kept, anything) + " " + listView(kept) + " " + (0 in kept) + " " + kept.includes(NaN) + " " + listView(anything));
}

// 64-bit integers.
function readBig(v: BigInt64Array, k: number): bigint { return v[k]; }
function plusBig(v: BigInt64Array, k: number): bigint { return v[k] + 1n; }
function writeBig(v: BigInt64Array, k: number, x: bigint): bigint { v[k] = x; return v[k]; }
function bigIsUndefined(v: BigInt64Array, k: number): boolean { return v[k] === undefined; }
function sumBig(v: BigInt64Array, from: number, to: number): bigint { let total = 0n; for (let i = from; i < to; i++) total += v[i]; return total; }
function readBigUnsigned(v: BigUint64Array, k: number): bigint { return v[k]; }
function writeBigUnsigned(v: BigUint64Array, k: number, x: bigint): bigint { v[k] = x; return v[k]; }

const big = new BigInt64Array([1n, -2n, 3n, -4n]), bigUnsigned = new BigUint64Array([1n, 2n, 3n, 4n]);
console.log("BigInt64Array | returned: " + inRuns(keys.map(k => twice(() => readBig(big, k)))));
console.log("BigInt64Array | + 1n: " + inRuns(keys.map(k => twice(() => plusBig(big, k)))));
console.log("BigInt64Array | === undefined: " + inRuns(keys.map(k => twice(() => bigIsUndefined(big, k)))));
console.log("BigInt64Array | sums: " + [[0, 4], [0, 5], [-1, 4], [1, 3]].map(([from, to]) => attempt(() => show(sumBig(big, from, to)))).join(" ; "));
const bigsToStore = [5n, -1n, 2n ** 63n - 1n, 2n ** 63n, -(2n ** 63n) - 1n, 2n ** 64n + 3n, 0n];
console.log("BigInt64Array | stored inside: " + bigsToStore.map(x => show(writeBig(big, 1, x))).join(" "));
console.log("BigInt64Array | stored outside: " + inRuns(bigsToStore.map(x => show(writeBig(big, 4, x)))) + " ; " + inRuns(keysToStoreAt.slice(2).map(k => show(writeBig(big, k, 5n)))) + " " + listView(big));
console.log("BigInt64Array | a number stored: " + [0, 4, -1, 1.5].map(k => attempt(() => show(writeBig(big, k, 1 as unknown as bigint)))).join(" ; ") + " " + listView(big));
console.log("BigUint64Array | returned: " + inRuns(keys.map(k => twice(() => readBigUnsigned(bigUnsigned, k)))));
console.log("BigUint64Array | stored inside: " + bigsToStore.map(x => show(writeBigUnsigned(bigUnsigned, 1, x))).join(" "));
console.log("BigUint64Array | stored outside: " + inRuns(bigsToStore.map(x => show(writeBigUnsigned(bigUnsigned, 4, x)))) + " " + listView(bigUnsigned));
(big.buffer as ArrayBuffer).transfer();
console.log("BigInt64Array | detached: " + big.length + " " + show(readBig(big, 0)) + " " + show(writeBig(big, 0, 5n)) + " " + attempt(() => show(plusBig(big, 0))) + " " + attempt(() => show(writeBig(big, 0, 1 as unknown as bigint))));
