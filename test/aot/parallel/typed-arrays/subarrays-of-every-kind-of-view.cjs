// subarray of views of every kind: positions from both ends and past them, heirs, own constructors, species, shared, resized and detached buffers, and stores through one view that another shows.
const kinds = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float16Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array];
const item = v => typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : String(v);
const lines = [], say = (...all) => lines.push(all.map(item).join(" "));
const attempt = f => { try { return f(); } catch (error) { return error.name; } };
const shown = v => v.constructor.name + ":" + v.byteOffset + ":" + v.length + ":" + Array.from(v, item).join();
const positions = [[], [0], [1], [2, 5], [-3], [-3, -1], [0, 100], [5, 2], [-100, 3], [undefined, 2], [1, undefined], [1.9, 4.1], [NaN, 3], ["1", "3"], [null, 2], [2 ** 31, 2 ** 32], [-(2 ** 31)], [true, 4]];
function of(View, big) { const buffer = new ArrayBuffer(View.BYTES_PER_ELEMENT * 8), view = new View(buffer, View.BYTES_PER_ELEMENT, 6); for (let i = 0; i < 6; i++) view[i] = big ? BigInt(i * 3 + 1) : i * 3 + 1; return view; }
for (const View of kinds) {
  const big = View.name.startsWith("Big"), view = of(View, big);
  let all = "";
  for (let round = 0; round < 2; round++) for (const [a, b] of positions) all += shown(view.subarray(a, b)) + ";";
  say(all);
  for (let i = 0; i < 4; i++) { const window = view.subarray(i, i + 3); window[1] = big ? 40n + BigInt(i) : 40 + i; window.subarray(1)[1] = big ? 2n : 2; }
  say(shown(view), view.subarray(1, 1).length, view.subarray(2).subarray(1, -1).byteOffset, view.subarray(1).buffer === view.buffer);
}
// Views whose kind the text names.
const view0 = new Int8Array([1, 2, 3, 4, 5, 6, 7, 8]);
function windows0(turns) { let s = ""; for (let i = 0; i < turns; i++) { const w = view0.subarray(i & 3, (i & 3) + 3), rest = view0.subarray(-2 - (i & 1)); s += w.byteOffset + "/" + rest.byteOffset + "/" + w[0] + w[2] + rest[0] + rest.length + w.subarray(1)[0] + w.subarray(1, 2).length + (w.buffer === view0.buffer) + ";"; w[1] = rest[0]; } return s; }
say(windows0(9), shown(view0));
const view1 = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
function windows1(turns) { let s = ""; for (let i = 0; i < turns; i++) { const w = view1.subarray(i & 3, (i & 3) + 3), rest = view1.subarray(-2 - (i & 1)); s += w.byteOffset + "/" + rest.byteOffset + "/" + w[0] + w[2] + rest[0] + rest.length + w.subarray(1)[0] + w.subarray(1, 2).length + (w.buffer === view1.buffer) + ";"; w[1] = rest[0]; } return s; }
say(windows1(9), shown(view1));
const view2 = new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]);
function windows2(turns) { let s = ""; for (let i = 0; i < turns; i++) { const w = view2.subarray(i & 3, (i & 3) + 3), rest = view2.subarray(-2 - (i & 1)); s += w.byteOffset + "/" + rest.byteOffset + "/" + w[0] + w[2] + rest[0] + rest.length + w.subarray(1)[0] + w.subarray(1, 2).length + (w.buffer === view2.buffer) + ";"; w[1] = rest[0]; } return s; }
say(windows2(9), shown(view2));
const view3 = new Int16Array([1, 2, 3, 4, 5, 6, 7, 8]);
function windows3(turns) { let s = ""; for (let i = 0; i < turns; i++) { const w = view3.subarray(i & 3, (i & 3) + 3), rest = view3.subarray(-2 - (i & 1)); s += w.byteOffset + "/" + rest.byteOffset + "/" + w[0] + w[2] + rest[0] + rest.length + w.subarray(1)[0] + w.subarray(1, 2).length + (w.buffer === view3.buffer) + ";"; w[1] = rest[0]; } return s; }
say(windows3(9), shown(view3));
const view4 = new Uint16Array([1, 2, 3, 4, 5, 6, 7, 8]);
function windows4(turns) { let s = ""; for (let i = 0; i < turns; i++) { const w = view4.subarray(i & 3, (i & 3) + 3), rest = view4.subarray(-2 - (i & 1)); s += w.byteOffset + "/" + rest.byteOffset + "/" + w[0] + w[2] + rest[0] + rest.length + w.subarray(1)[0] + w.subarray(1, 2).length + (w.buffer === view4.buffer) + ";"; w[1] = rest[0]; } return s; }
say(windows4(9), shown(view4));
const view5 = new Int32Array([1, 2, 3, 4, 5, 6, 7, 8]);
function windows5(turns) { let s = ""; for (let i = 0; i < turns; i++) { const w = view5.subarray(i & 3, (i & 3) + 3), rest = view5.subarray(-2 - (i & 1)); s += w.byteOffset + "/" + rest.byteOffset + "/" + w[0] + w[2] + rest[0] + rest.length + w.subarray(1)[0] + w.subarray(1, 2).length + (w.buffer === view5.buffer) + ";"; w[1] = rest[0]; } return s; }
say(windows5(9), shown(view5));
const view6 = new Uint32Array([1, 2, 3, 4, 5, 6, 7, 8]);
function windows6(turns) { let s = ""; for (let i = 0; i < turns; i++) { const w = view6.subarray(i & 3, (i & 3) + 3), rest = view6.subarray(-2 - (i & 1)); s += w.byteOffset + "/" + rest.byteOffset + "/" + w[0] + w[2] + rest[0] + rest.length + w.subarray(1)[0] + w.subarray(1, 2).length + (w.buffer === view6.buffer) + ";"; w[1] = rest[0]; } return s; }
say(windows6(9), shown(view6));
const view7 = new Float16Array([1, 2, 3, 4, 5, 6, 7, 8]);
function windows7(turns) { let s = ""; for (let i = 0; i < turns; i++) { const w = view7.subarray(i & 3, (i & 3) + 3), rest = view7.subarray(-2 - (i & 1)); s += w.byteOffset + "/" + rest.byteOffset + "/" + w[0] + w[2] + rest[0] + rest.length + w.subarray(1)[0] + w.subarray(1, 2).length + (w.buffer === view7.buffer) + ";"; w[1] = rest[0]; } return s; }
say(windows7(9), shown(view7));
const view8 = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]);
function windows8(turns) { let s = ""; for (let i = 0; i < turns; i++) { const w = view8.subarray(i & 3, (i & 3) + 3), rest = view8.subarray(-2 - (i & 1)); s += w.byteOffset + "/" + rest.byteOffset + "/" + w[0] + w[2] + rest[0] + rest.length + w.subarray(1)[0] + w.subarray(1, 2).length + (w.buffer === view8.buffer) + ";"; w[1] = rest[0]; } return s; }
say(windows8(9), shown(view8));
const view9 = new Float64Array([1, 2, 3, 4, 5, 6, 7, 8]);
function windows9(turns) { let s = ""; for (let i = 0; i < turns; i++) { const w = view9.subarray(i & 3, (i & 3) + 3), rest = view9.subarray(-2 - (i & 1)); s += w.byteOffset + "/" + rest.byteOffset + "/" + w[0] + w[2] + rest[0] + rest.length + w.subarray(1)[0] + w.subarray(1, 2).length + (w.buffer === view9.buffer) + ";"; w[1] = rest[0]; } return s; }
say(windows9(9), shown(view9));
const view10 = new BigInt64Array([1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n]);
function windows10(turns) { let s = ""; for (let i = 0; i < turns; i++) { const w = view10.subarray(i & 3, (i & 3) + 3), rest = view10.subarray(-2 - (i & 1)); s += w.byteOffset + "/" + rest.byteOffset + "/" + w[0] + w[2] + rest[0] + rest.length + w.subarray(1)[0] + w.subarray(1, 2).length + (w.buffer === view10.buffer) + ";"; w[1] = rest[0]; } return s; }
say(windows10(9), shown(view10));
const view11 = new BigUint64Array([1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n]);
function windows11(turns) { let s = ""; for (let i = 0; i < turns; i++) { const w = view11.subarray(i & 3, (i & 3) + 3), rest = view11.subarray(-2 - (i & 1)); s += w.byteOffset + "/" + rest.byteOffset + "/" + w[0] + w[2] + rest[0] + rest.length + w.subarray(1)[0] + w.subarray(1, 2).length + (w.buffer === view11.buffer) + ";"; w[1] = rest[0]; } return s; }
say(windows11(9), shown(view11));
class Heir extends Int16Array { get extra() { return 1; } }
class Other extends Float32Array { static get [Symbol.species]() { return Float64Array; } }
const own = new Int32Array([1, 2, 3, 4]); own.constructor = Float32Array;
const strange = Object.setPrototypeOf(new Uint16Array([1, 2, 3]), Heir.prototype);
for (const v of [new Heir([1, 2, 3]), new Other([1, 2, 3]), own, strange, Object.assign(new Float64Array([1, 2, 3]), { extra: 1 })]) { let all = ""; for (let i = 0; i < 3; i++) all += attempt(() => shown(v.subarray(i, 3))) + ";"; say(all); }
const buffer = new ArrayBuffer(16, { maxByteLength: 32 }), tracking = new Int16Array(buffer), fixed = new Int16Array(buffer, 2, 4);
let all = ""; for (let i = 0; i < 12; i++) { all += attempt(() => shown(tracking.subarray(1))) + "/" + attempt(() => shown(fixed.subarray(1, 3))) + ";"; if (i === 3) buffer.resize(32); if (i === 6) buffer.resize(6); if (i === 9) buffer.resize(20); } say(all);
const gone = new Uint32Array(4); all = ""; for (let i = 0; i < 5; i++) { all += attempt(() => shown(gone.subarray(1))) + ";"; if (i === 2) gone.buffer.transfer(); } say(all);
const shared = new Int32Array(new SharedArrayBuffer(16)); for (let i = 0; i < 4; i++) shared.subarray(i)[0] = i * i; say(shown(shared), shared.subarray(1).buffer instanceof SharedArrayBuffer);
function any(v, a, b) { return v.subarray(a, b); }
for (let i = 0; i < 3; i++) say(shown(any(new Int8Array([1, 2, 3]), i)), shown(any(new Float64Array([1, 2, 3]), 0, i)), attempt(() => any([1, 2], 0)), any({ subarray: (a, b) => a + b }, 1, 2), any(Buffer.from("text"), i).toString());
console.log(lines.join("\n"));
