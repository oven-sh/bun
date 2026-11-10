const words = new BigUint64Array(1), floats = new Float64Array(words.buffer), singles = new Float32Array(1), bitsOfSingles = new Uint32Array(singles.buffer);
let held = 0;
function put(x) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; held = x; return work; }
function show() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return String(held) + "/" + typeof held + "/" + (held ?? "none") + "/" + Object.is(held, -0) + "/" + (held === held) + work; }
const lines = [show()];
for (const x of [1.5, -0, undefined, null, NaN, Infinity, 2 ** 53]) { put(x); lines.push(show()); }
console.log(lines.join(" "));
let numberOfNaNs = 0;
for (const bits of [0x7ffa000000000000n, 0x7ffb000000000000n, 0x7ffc000000000000n, 0xfffc000000000000n, 0x7ffa000000000001n]) { words[0] = bits; put(floats[0]); if (show() === "NaN/number/NaN/false/false1") numberOfNaNs++; }
for (const bits of [0x7fd00000, 0x7fd80000, 0x7fe00000]) { bitsOfSingles[0] = bits; put(singles[0]); if (show() === "NaN/number/NaN/false/false1") numberOfNaNs++; }
console.log(numberOfNaNs, "of 8");
function early() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return late + work; }
let threw = "none";
try { early(); } catch (error) { threw = error.name; }
let late = 0.5, ticks = 0, depth = 0;
async function tickLater(by) { ticks += by; await null; ticks += by; return ticks; }
function* stepper() { while (ticks < 4) { ticks += 0.5; yield ticks; } }
function guarded(fails) { depth++; try { if (fails) throw new RangeError("deep"); return depth; } finally { depth--; } }
const first = tickLater(1), second = tickLater(0.25);
const ended = [await first, await second];
let caught = "none";
try { guarded(true); } catch (error) { caught = error.name; }
console.log(threw, early(), ended.join(), [...stepper()].join(), guarded(false), caught, depth);
let count = 0, size = null;
function bump() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; count = (count + work) | 0; return count; }
function jump() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; count = 2147483647; return work; }
function measure(text) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; size = text.length; return size + work; }
function forget(way) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; size = way ? undefined : null; return work; }
console.log(bump(), bump(), jump(), bump(), String(size), measure("abcd"), size, forget(true), String(size), forget(false), String(size), count >>> 0);
