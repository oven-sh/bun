// Typed array loops: length, vector and mode are hoisted when nothing in the loop can change them. These loops do change them: a buffer resized or transferred by a rarely taken call, a length-tracking view, a subclass, an out-of-bounds read.
declare const console: { log(...v: unknown[]): void };
function tones(view: Uint8Array): number { let low = 0, high = 0, pairs = 0, last = -1; for (let at = 0; at < view.length; at++) { const tone = view[at]!; if (tone < 64) low++; else high += tone; if (tone === last) pairs++; if ((tone & 3) === 1) low += 2; last = tone; } return low + high * 7 + pairs * 10007; }
function climbs(heights: Int32Array): number { let ups = 0, largest = 0, before = 0; for (let at = 0; at < heights.length; at++) { const step = heights[at]! - before; if (step > 0) ups++; if (step > largest) largest = step; before += step; } return ups * 4099 + largest; }
function energy(wave: Float64Array, floor: number): number { let kept = 0, total = 0; for (let at = 0; at < wave.length; at++) { const square = wave[at]! * wave[at]!; if (square > floor) { kept++; total += square; } } return kept + Math.round(total); }
function pastTheEnd(bytes: Uint8Array): string { let out = ""; for (let i = 0; i <= bytes.length; i++) out += bytes[i] + ","; return out; }
function seldom(bytes: Uint8Array, at: number, act: () => void): string { let out = ""; for (let i = 0; i < bytes.length; i++) { if (i === at) act(); out += bytes[i] + ","; } return out + bytes.length; }
function seldomWrites(bytes: Uint8Array, at: number, act: () => void): string { for (let i = 0; i < bytes.length; i++) { if (i === at) act(); bytes[i] = i + 100; } return Array.from(bytes).join() + ":" + bytes.length; }
class Named extends Uint8Array { name = "named"; }
class Shorter extends Uint8Array { get length(): number { return 3; } }

const text = new Uint8Array(200); for (let i = 0; i < text.length; i++) text[i] = i % 11 === 0 ? 10 : i % 5 === 0 ? 32 : 48 + (i % 40);
const ints = new Int32Array(200); for (let i = 0; i < ints.length; i++) ints[i] = ((i * 37) % 23) - 9;
const floats = new Float64Array(200); for (let i = 0; i < floats.length; i++) floats[i] = Math.sin(i / 7) * 10; floats[50] = NaN; floats[51] = Infinity > 0 ? 1e300 : 0; floats[51] = 12;
const out: unknown[] = [];
for (let r = 0; r < 3; r++) out.push(tones(text), climbs(ints), energy(floats, 2.5), tones(new Uint8Array(0)), climbs(new Int32Array(1)), energy(new Float64Array(2), -1));
out.push(tones(new Named(text)), tones(new Shorter(text)), tones(text.subarray(7, 90)), pastTheEnd(text.subarray(0, 3)), pastTheEnd(new Uint8Array(0)));
function tracking(): [ArrayBuffer, Uint8Array] { const buffer = new ArrayBuffer(8, { maxByteLength: 16 }); const view = new Uint8Array(buffer); for (let i = 0; i < 8; i++) view[i] = i + 1; return [buffer, view]; }
{ const [buffer, view] = tracking(); out.push(tones(view), seldom(view, 3, () => buffer.resize(5))); }
{ const [buffer, view] = tracking(); out.push(seldom(view, 3, () => buffer.resize(12))); }
{ const [buffer, view] = tracking(); out.push(seldom(view, 2, () => { buffer.transfer(); })); }
{ const [buffer, view] = tracking(); out.push(seldomWrites(view, 3, () => buffer.resize(5))); }
{ const [buffer, view] = tracking(); out.push(seldomWrites(view, 6, () => buffer.resize(10))); }
{ const fixed = new Uint8Array(6); out.push(seldom(fixed, 2, () => { structuredClone(fixed.buffer, { transfer: [fixed.buffer] }); }), seldomWrites(new Uint8Array(4), 9, () => {})); }
{ const [buffer] = tracking(); const part = new Uint8Array(buffer, 2, 4); out.push(seldom(part, 1, () => buffer.resize(4)), pastTheEnd(part)); }
console.log(out.join(" "));
