// Counters in variables of a module, in a captured variable, in a field and in a static field, each taken past the ends where a form could go wrong: 2 ** 31, 2 ** 32, 2 ** 53, and their negatives.
// The reference is `bun <this file>`.
let calls = 0;
const bumps = [() => { calls++; }, () => { calls += 1; }, () => { calls = calls + 1; }];
for (let turn = 0; turn < 3000; turn++) bumps[turn % 3]();
console.log("calls", calls, bumps.length);

let pastInt32 = 2147483645;
function stepPastInt32() { pastInt32++; return pastInt32; }
console.log("int32", stepPastInt32(), stepPastInt32(), stepPastInt32(), stepPastInt32(), pastInt32 | 0, pastInt32 % 7, [10, 20, 30][pastInt32 - 2147483648]);

let pastUint32 = 4294967294;
function stepPastUint32() { return ++pastUint32; }
console.log("uint32", stepPastUint32(), stepPastUint32(), stepPastUint32(), pastUint32 >>> 0, pastUint32 >> 1);

let pastExact = 9007199254740990;
function stepPastExact() { pastExact++; return pastExact; }
console.log("exact", stepPastExact(), stepPastExact(), stepPastExact(), stepPastExact(), pastExact === 9007199254740992, pastExact + 1 === pastExact);

let belowExact = -9007199254740990;
function stepBelowExact() { belowExact--; return belowExact; }
console.log("exact, down", stepBelowExact(), stepBelowExact(), stepBelowExact(), stepBelowExact(), belowExact - 1 === belowExact);

let belowZero = 1;
function stepBelowZero() { belowZero -= 1; return belowZero; }
console.log("zero", stepBelowZero(), stepBelowZero(), stepBelowZero(), Object.is(belowZero + 1, 0), 1 / (belowZero + 1));

function makeTicker(start) {
    let ticks = start;
    return { tick() { ticks++; return ticks; }, back() { return --ticks; } };
}
const ticker = makeTicker(2147483646);
console.log("captured", ticker.tick(), ticker.tick(), ticker.tick(), ticker.back(), ticker.back(), ticker.back());

class Meter {
    static made = 0;
    reading = 0;
    low = 0;
    constructor() { Meter.made++; }
    turn() { this.reading++; this.low = this.reading & 255; return this.reading; }
}
const meter = new Meter(), other = new Meter();
for (let turn = 0; turn < 1000; turn++) meter.turn();
other.reading = 2147483647;
console.log("field", meter.reading, meter.low, other.turn(), other.turn(), other.low, Meter.made);

const widths = new Map([["narrow", 1], ["wide", 9]]);
widths.set("huge", 4096);
let total = 0;
for (const name of ["narrow", "wide", "huge", "none"]) total += widths.get(name) ?? 0;
const sizes = [3, 5, 8];
sizes.push(sizes.length * 4);
console.log("contents", total, sizes.join(), sizes[sizes.length - 1] - sizes[0], "abc".length - "abcdef".length);

let sometimesText = 0;
function stepOrText(text) { if (text) sometimesText = "text"; else sometimesText++; return sometimesText; }
console.log("text", stepOrText(false), stepOrText(false), stepOrText(true), stepOrText(false));

let sometimesHalf = 0;
function stepOrHalf(half) { sometimesHalf = half ? sometimesHalf + 0.5 : sometimesHalf + 1; return sometimesHalf; }
console.log("half", stepOrHalf(false), stepOrHalf(true), stepOrHalf(false));

function early() { return late; }
let threw = false;
try { early(); } catch (error) { threw = error instanceof ReferenceError; }
let late = 0;
function stepLate() { return ++late; }
console.log("dead zone", threw, stepLate(), early());
