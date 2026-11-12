// ArrayBuffer.isView() of every kind of value, in loops, conditions, filters, by value, with no, several and spread arguments.
class Bytes extends Uint8Array { x = 1; } class View extends DataView {}
const values = { undef: undefined, nul: null, yes: true, int: 5, dbl: 1.5, nan: NaN, big: 5n, text: "t", empty: "", symbol: Symbol("s"), fn: () => 1, cls: class {}, obj: {}, arr: [1], date: new Date(0), regexp: /a/, map: new Map(), set: new Set(), weak: new WeakMap(), err: new Error("e"), promise: Promise.resolve(1), proxy: new Proxy(new Uint8Array(1), {}), proxyView: new Proxy(new DataView(new ArrayBuffer(1)), {}), heir: Object.create(new Uint8Array(1)), proto: Uint8Array.prototype, boxed: Object(5), gen: (function* () {})(),
  buffer: new ArrayBuffer(8), shared: new SharedArrayBuffer(8), i8: new Int8Array(1), u8: new Uint8Array(1), c8: new Uint8ClampedArray(1), i16: new Int16Array(1), u16: new Uint16Array(1), i32: new Int32Array(1), u32: new Uint32Array(1), f16: new Float16Array(1), f32: new Float32Array(1), f64: new Float64Array(1), b64: new BigInt64Array(1), bu64: new BigUint64Array(1), dataview: new DataView(new ArrayBuffer(2)), node: Buffer.from("ab"), bytes: new Bytes(2), view: new View(new ArrayBuffer(2)), zero: new Uint8Array(0), onShared: new Uint8Array(new SharedArrayBuffer(2)), changed: Object.setPrototypeOf(new Uint8Array(1), null), frozenEmpty: Object.freeze(new Uint8Array(0)) };
const list = Object.entries(values);
function asked(v) { return ArrayBuffer.isView(v); }
function branch(v) { if (ArrayBuffer.isView(v)) return v.byteLength; return -1; }
function both(v) { return !ArrayBuffer.isView(v) || v instanceof DataView ? "a" : "b"; }
function typed(/** @type {Uint8Array} */ v) { return ArrayBuffer.isView(v) ? v.length : 0; }
function length(v) { return ArrayBuffer.isView(v) ? v.byteLength : v instanceof ArrayBuffer ? v.byteLength : typeof v === "string" ? v.length : 0; }
for (let turn = 0; turn < 4; turn++) {
  let t = "";
  for (const [n, v] of list) t += n + asked(v) + (n === "changed" ? "" : branch(v)) + both(v) + (v == null ? "" : length(v)) + " ";
  console.log(t);
  let r = 0; for (let i = 0; i < list.length; i++) { const v = list[i][1]; if (ArrayBuffer.isView(v)) r += i; else r -= 1; }
  console.log(r, list.filter(([, v]) => ArrayBuffer.isView(v)).length, list.map(e => e[1]).filter(ArrayBuffer.isView).length, list.findIndex(([, v]) => ArrayBuffer.isView(v)), typed(new Uint8Array(3)));
}
console.log(ArrayBuffer.isView(), ArrayBuffer.isView(1, new Uint8Array(1)), ArrayBuffer.isView(new Uint8Array(1), 2), ArrayBuffer.isView(...[new Uint8Array(1)]), ArrayBuffer.isView(...[]), ArrayBuffer.isView.call(null, new Uint8Array(1)), ArrayBuffer.isView.apply(5, [new DataView(new ArrayBuffer(1))]), ArrayBuffer["is" + "View"](new Int8Array(1)), ArrayBuffer.isView.name, ArrayBuffer.isView.length);
const { isView } = ArrayBuffer; console.log(isView(new Uint8Array(1)), isView({}), [1, new Uint8Array(1)].map(isView).join());
let order = ""; console.log(ArrayBuffer.isView((order += "a", new Uint8Array(1)), (order += "b", 1)), order);
const moved = new Uint8Array(4); structuredClone(moved.buffer, { transfer: [moved.buffer] }); console.log(ArrayBuffer.isView(moved), moved.length);
