// Stores that add properties to typed arrays and Buffers, at sites that see one kind and at sites that see many.
const say = (...values) => console.log(...values.map(value => (typeof value === "string" ? value : JSON.stringify(value))));
const attempt = body => {
  try {
    return body();
  } catch (error) {
    return error.constructor.name + ": " + error.message;
  }
};
const own = view => Reflect.ownKeys(view).map(String).join();
const bytes = view => Array.from(view).join();

class Tagged extends Uint8Array {
  kind = "tagged";
  constructor(...values) {
    super(...values);
    this.extra = values.length;
  }
  set guarded(value) { this.stored = [value]; }
  get guarded() { return this.stored; }
}
Object.defineProperty(Tagged.prototype, "fixed", { value: "fixed", writable: false });

const makers = {
  alloc: () => Buffer.alloc(4, 7),
  from: () => Buffer.from("abcd"),
  unsafe: () => Buffer.allocUnsafe(4).fill(1),
  empty: () => Buffer.alloc(0),
  large: () => new Uint8Array(5000).fill(9),
  uint8: () => new Uint8Array(4),
  clamped: () => new Uint8ClampedArray(4),
  int8: () => new Int8Array(4),
  uint16: () => new Uint16Array(4),
  int16: () => new Int16Array(4),
  uint32: () => new Uint32Array(4),
  int32: () => new Int32Array(4),
  float32: () => new Float32Array(4),
  float64: () => new Float64Array([1.5, 2.5]),
  bigint: () => new BigInt64Array(2),
  overBuffer: () => new Uint8Array(new ArrayBuffer(8), 2, 4),
  resizable: () => new Uint8Array(new ArrayBuffer(4, { maxByteLength: 16 })),
  shared: () => new Uint8Array(new SharedArrayBuffer(4)),
  sub: () => new Uint8Array(8).subarray(1, 5),
  slice: () => Buffer.from("abcdef").slice(1, 4),
  heir: () => new Tagged(4),
  dataView: () => new DataView(new ArrayBuffer(4)),
};

function addTwo(view, i) {
  view.tag = i;
  view.other = { i };
  return view;
}
function addMany(view, count) {
  for (let k = 0; k < count; k++) view["name" + k] = k;
  return view;
}

for (const [name, make] of Object.entries(makers)) {
  let last;
  for (let i = 0; i < 60; i++) last = addTwo(make(), i);
  const named = own(last).split(",").filter(key => !/^\d+$/.test(key));
  say(name, named, last.tag, last.other, name === "dataView" ? "" : name === "bigint" ? "big" : bytes(last).slice(0, 12));
}

function addInLoop(count) {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const view = new Uint8Array(4);
    view.tag = i;
    view.next = view.tag + 1;
    view[1] = i;
    sum += view.next + view[1] + view.length;
  }
  return sum;
}
say("addInLoop", addInLoop(300));

// Names that a typed array treats apart.
for (const key of ["0", "3", "4", "-1", "-0", "1.5", "NaN", "Infinity", "-Infinity", "1e21", "4294967294", "4294967295", "4294967296", "9007199254740993", "01", "+1", "1e3", " 1", "", "length", "byteLength", "byteOffset", "buffer", "constructor", "fill", "name", "then", "__proto__"]) {
  const found = [];
  for (let i = 0; i < 4; i++) {
    const view = new Uint8Array(4);
    const result = attempt(() => { view[key] = 300 + i; });
    found.push([result === undefined ? "stored" : result.split(":")[0], Object.hasOwn(view, key), view[0], view[3], own(view).length]);
  }
  say("key", JSON.stringify(key), found[0], found[3]);
}
function storeNaN(view) { view.NaN = 1; return Object.hasOwn(view, "NaN"); }
function storeInfinity(view) { view.Infinity = 1; return Object.hasOwn(view, "Infinity"); }
for (let i = 0; i < 20; i++) if (storeNaN(new Uint8Array(1)) || storeInfinity(Buffer.alloc(1))) say("created a numeric name", i);
const symbol = Symbol("own");
function storeSymbol(view, i) { view[symbol] = i; return view; }
let last;
for (let i = 0; i < 20; i++) last = storeSymbol(Buffer.alloc(2), i);
say("symbol", last[symbol], own(last));

// Refusals.
function refuse(view) { view.tag = 1; return Object.hasOwn(view, "tag"); }
for (let i = 0; i < 12; i++) {
  const view = new Uint8Array(i % 3 === 2 ? 0 : 2);
  if (i % 3 === 1) Object.preventExtensions(view);
  if (i % 3 === 2) Object.freeze(view);
  say("refuse", i % 3, attempt(() => refuse(view)));
}
for (let i = 0; i < 8; i++) {
  const view = new Tagged(2);
  view.guarded = i;
  const refused = attempt(() => { view.fixed = i; });
  say("heir", own(view), view.guarded, view.fixed, refused === undefined ? "" : refused.split(":")[0]);
}

// The array buffer is asked for before, between and after.
for (let i = 0; i < 30; i++) {
  const view = new Uint8Array(6).fill(i);
  if (i % 5 === 0) view.buffer;
  view.first = i;
  if (i % 5 === 1) view.buffer;
  view.second = [i];
  if (i % 5 === 2) view.buffer;
  view.third = { i };
  if (i % 5 === 3) view.buffer;
  view.fourth = "t" + i;
  if (i % 5 === 4) view.buffer;
  view.fifth = -i;
  const same = new Uint8Array(view.buffer);
  same[0] = 99;
  if (i > 24) say("buffer", view.first, view.second, view.third, view.fourth, view.fifth, bytes(view), view.buffer.byteLength, own(view));
}

// Collections.
const keptViews = [];
for (let i = 0; i < 200; i++) {
  const view = i & 1 ? Buffer.alloc(8, i) : new Uint8Array(3000).fill(i);
  view.label = "label" + i;
  view.list = [i, { deep: "deep" + i }];
  if (i % 20 === 0) keptViews.push(view);
  if (i % 50 === 0) Bun.gc(true);
}
Bun.gc(true);
say("kept", keptViews.map(view => [view.label, view.list[1].deep, view[1]]));

// Many names, deleted names, a detached buffer, a prototype that changes.
last = addMany(new Uint8Array(2), 100);
say("many", Object.keys(last).length, last.name0, last.name99);
for (let i = 0; i < 12; i++) {
  const view = addMany(Buffer.alloc(1), 6);
  if (i & 1) delete view.name2;
  view.added = i;
  view.name2 = "again";
  if (i > 9) say("deleted", own(view), view.name2);
}
for (let i = 0; i < 6; i++) {
  const view = new Uint8Array(4);
  if (i & 1) structuredClone(view.buffer, { transfer: [view.buffer] });
  view.tag = i;
  say("detached", view.length, view.tag, own(view));
}
for (let i = 0; i < 9; i++) {
  const view = new Uint8Array(2);
  const seen = [];
  if (i % 3 === 1) Object.setPrototypeOf(view, { set tag(value) { seen.push(value); } });
  if (i % 3 === 2) Object.setPrototypeOf(view, null);
  view.tag = i;
  say("prototype", i % 3, seen, Object.prototype.hasOwnProperty.call(view, "tag"));
}
for (let i = 0; i < 6; i++) {
  const seen = [];
  class Late extends Uint8Array {}
  const make = () => { const view = new Late(1); view.late = seen.length; return view; };
  make();
  Object.defineProperty(Late.prototype, "late", { set(value) { seen.push(value); } });
  const view = make();
  if (i > 4) say("late", seen, own(view));
}
for (const define of [view => Object.defineProperty(view, "tag", { value: 1, writable: false, configurable: true }), view => Object.defineProperty(view, "tag", { set(value) { this[0] = value; }, configurable: true })]) {
  for (let i = 0; i < 5; i++) {
    const view = define(new Uint8Array(2));
    const result = attempt(() => { view.tag = 5; });
    if (i === 4) say("own", result === undefined ? "" : result.split(":")[0], view[0], own(view));
  }
}
