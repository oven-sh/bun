// Fractions go in loops into clamped views that begin in the middle of a buffer, lie on a shared buffer, follow a buffer that is resized or detached in the middle of the loop, or are of a class below; by `=`, `+=`, `*=`, `++`; at positions inside, at the end, outside, negative and fractional.
const out = []; const say = v => out.push(Array.from(v).join());
const halves = new Float64Array(40); for (let i = 0; i < 40; i++) halves[i] = i * 6.5 - 3.25 + (i % 3) * 0.25;
const whole = new ArrayBuffer(24), middle = new Uint8ClampedArray(whole, 5, 9); for (let i = -2; i < 12; i++) middle[i] = halves[i + 2]; say(new Uint8Array(whole));
const shared = new Uint8ClampedArray(new SharedArrayBuffer(8)); for (let r = 0; r < 3; r++) for (let i = 0; i < 8; i++) shared[i] += halves[i + r] * 0.5; say(shared);
const grows = new ArrayBuffer(4, { maxByteLength: 12 }), follows = new Uint8ClampedArray(grows); for (let i = 0; i < 12; i++) { if (i === 3) grows.resize(10); if (i === 8) grows.resize(6); follows[i] = halves[i] + 0.5; } say(follows);
const leaves = new Uint8ClampedArray(8); for (let i = 0; i < 8; i++) { if (i === 4) structuredClone(leaves.buffer, { transfer: [leaves.buffer] }); leaves[i] = halves[i] + 1.5; } out.push(leaves.length);
class Pixels extends Uint8ClampedArray { at2(i) { return this[i] * 2; } } const below = new Pixels(6); for (let i = 0; i < 6; i++) { below[i] = halves[i + 7] / 3; below[i] *= 1.5; below[i]++; } say(below); out.push(below.at2(1));
const odd = new Uint8ClampedArray(4); for (const k of [0, 1.5, -0, 3, 4, -1, NaN, "2", "1.0"]) for (let r = 0; r < 2; r++) odd[k] = 100.5 + r; say(odd); out.push(Object.keys(odd).join());
function blend(p, t) { for (let i = 0; i < p.length; i += 4) { const v = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]; p[i] += (v - p[i]) * t; p[i + 1] += (v - p[i + 1]) * t; p[i + 2] -= (p[i + 2] - v) * t; p[i + 3] = 255.5 - v; } return p; }
const picture = new Uint8ClampedArray(32); for (let i = 0; i < 32; i++) picture[i] = i * 8.5; for (const t of [0.5, 0.25, 1.75, -2, NaN, Infinity]) say(blend(picture, t));
let h = 7; for (const x of out) for (const c of String(x)) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0; console.log(out.length, h, out.slice(0, 6).join(" | "));
