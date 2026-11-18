// Properties whose values native code provides

const made = (get, set) => Object.assign(customs(), { get, set, tag: "own" });
const heir = (parent, more) => Object.assign(Object.create(parent), { tag: "heir" }, more);
const shared = made(() => 1);
const objects = () => [
  [made(() => 1)],
  [heir(shared)],
  [heir(heir(shared), { other: 1 })],
  [heir(made(() => 2))],
  [{ holder: { tag: 1 }, receiver: { tag: 2 }, name: 3, nothing: 4, length: 5 }],
  [Object.defineProperty(heir(shared), "receiver", { value: { tag: "shadow" } })],
  [7],
  [null],
];
check(o => o.holder.tag + o.receiver.tag, objects);
check(o => [o.name, o.length], objects);
check(o => Object.keys({ kept: o.nothing, ...[o.nothing] }) + typeof o.nothing + (o.nothing === undefined), objects);
check(o => o["name"] + o.name.length, objects);
checkInTurn(o => [o.holder?.tag, o.receiver?.tag, o.nothing], objects);

const results = () => values().map(it => [made(() => it)]).concat([[made(() => { throw new RangeError("get"); })]]);
check(o => o.length + 1, results);
check(o => { let before = 1; try { before = 2; return o.length; } catch (e) { return before + e.message; } }, results);
check(o => { const seen = o.tag; o.get = function () { this.tag = "changed"; }; o.length; return seen + o.tag; }, objects);
check((o, v) => { let got; o.set = function (it) { got = [this.tag, it]; }; o.length = v; return got; }, () => objects().map(([o], i) => [o, values()[i]]));
check((o, v) => { let got; o.set = function (it) { got = [this.tag, it]; }; o.holder = v; return [got, Object.keys(o)]; }, () => objects().map(([o]) => [o, 1]));
check(o => { try { o.name = 1; } catch (e) { return e.message; } }, () => [[made(0, () => {})], [made(0, () => { throw new Error("set"); })]]);

{
  const parent = made(() => 1), child = heir(parent), read = o => o.name;
  for (let i = 0; i < 200; i++) if (read(child) !== "name") throw new Error("inherited");
  Object.defineProperty(parent, "name", { value: "replaced" });
  if (read(child) !== "replaced") throw new Error("the accessor is gone");
}

{
  const plain = () => Array.from({ length: 5 }, (_, i) => [{ ["key" + i]: i }]), kept = [[overriding()], ...plain()];
  checkInTurn(o => { o.name = 1; return o.name; }, () => [...plain(), ...kept], 40);
}

// Clocks

check(() => { const a = tick(), b = tick(); tick(); return [b - a, tick() - b]; }, () => [[]]);
check(n => { let last = tick(), steps = 0; for (let i = 0; i < n; i++) { const now = tick(1); steps += now - last; last = now; } return steps; }, () => [[50]]);

// Foreign functions

const types = { i8: 1, u8: 2, i16: 3, u16: 4, i32: 5, u32: 6, i64: 7, u64: 8, f64: 9, f32: 10, bool: 11, ptr: 12, void: 13,
  cstring: 14, i64_fast: 15, u64_fast: 16, function: 17, value: 19, buffer: 20, buffer_length: 21 };
const edges = () => [[-0], [200], [-40000], [2 ** 32 - 1], [2 ** 51], [2 ** 63], [1.5], [NaN], [true], [null], ["1"], [-1n], [{ valueOf: () => 3 }], []];
const words = () => [[0n], [200n], [-40000n], [2n ** 31n], [2n ** 53n - 1n], [2n ** 53n], [1n - 2n ** 53n], [-(2n ** 53n)]];
function checkForeign(target, result, argument, lists, use = it => it) {
  globalThis.subject = foreign(target, types[result], types[argument]);
  check(`a => { return ${use("subject(a)")}; }`, lists);
}
for (const type of ["i8", "u8", "i16", "u16", "i32", "u32", "u64", "bool", "ptr", "function"]) checkForeign(0, "i64", type, edges);
for (const type of ["u64", "ptr", "i64_fast", "u64_fast"]) checkForeign(0, type, "i64", words);
for (const type of ["i8", "u8", "i16", "u16", "i32", "u32", "bool", "void"]) checkForeign(1, type, "i64", words, it => `[${it}, ${it} + 1]`);
checkForeign(0, "u32", "i64", words, it => `${it} * 3 + 1`);
checkForeign(0, "ptr", "ptr", edges, it => `${it} - 1`);
checkForeign(0, "value", "value", singles);
checkForeign(0, "value", "i32", () => [[0], [10], [7]]);
checkForeign(2, "f64", "f64", edges, it => `1 / ${it}`);
checkForeign(3, "f32", "f32", edges, it => `${it} * 0.1`);
checkForeign(4, "f64", "u64", () => [[0n], [2n ** 63n], [2n ** 64n - 1n], [0x7ff0000000000001n]], it => `[typeof ${it}, ${it}]`);

const views = () => {
  const resizable = new ArrayBuffer(8, { maxByteLength: 16 }), tracking = new Uint8Array(resizable), detached = new Uint8Array(4);
  resizable.resize(12);
  detached.buffer.transfer();
  return [[new Uint8Array(3)], [new Int32Array(3)], [new DataView(new ArrayBuffer(5))], [tracking], [detached], [new ArrayBuffer(2)], [null], [5]];
};
checkForeign(0, "i32", "buffer_length", views);
for (const type of ["ptr", "buffer", "cstring"]) checkForeign(0, "ptr", type, views, it => `typeof ${it}`);

globalThis.weigh = foreign(5, 9, 5, 9, 7, 10, 6, 9, 7, 9, 7, 9, 7, 9, 7, 9, 7, 9, 7, 10, 7, 9);
check((a, b) => weigh(a, b, 3, a, b, 6, a, b, 9, a, b, 12, a, b, 15, a, b, 18, a, b), () => [[1, 2], [-1, 2 ** 32], [0.5, 2], [1n, 2]]);
check((a, b) => weigh(a, b), () => [[1, 2]]);
check(a => { "use strict"; return subject(a, 1, 2) === null; }, views);

globalThis.readAfterCalling = foreign(6, types.i32, types.function, types.buffer, types.buffer_length);
globalThis.act = null;
globalThis.acting = callback(n => act(n), types.i32, types.i32).ptr;
const actions = () => [
  [n => n],
  [n => { for (let i = 0; i < 300; i++) new Uint8Array(2000).fill(9); return -n; }],
  [() => { throw new RangeError("called back"); }],
];
globalThis.readSoMany = foreign(6, types.i32, types.function, types.buffer, types.u32);
check(action => { act = action; return readSoMany(acting, new Uint8Array(2000), 2000); }, actions);
check(action => { act = action; const bytes = new Uint8Array(4), before = bytes[0]; readAfterCalling(acting, bytes, bytes); return [before, bytes[0]]; }, actions);
check(action => { act = action; let step = 1; try { step = 2; return readAfterCalling(acting, new Uint8Array(1), new Uint8Array(1)); } catch (e) { return step + e.message; } }, actions);
