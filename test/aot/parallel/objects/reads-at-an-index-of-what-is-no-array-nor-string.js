// A read at a small integer of whatever comes: each kind of view, and the objects that only look alike to the entry for an index.
const hide = Function("value", "return value");
function at(object, i) {
  return object[i | 0];
}
const buffer = new ArrayBuffer(32);
const sources = {
  uint8: new Uint8Array([200, 1, 2]),
  clamped: new Uint8ClampedArray([255, 1, 2]),
  int8: new Int8Array([-1, 1, 2]),
  uint16: new Uint16Array([65535, 1, 2]),
  int16: new Int16Array([-2, 1, 2]),
  int32: new Int32Array([-3, 1, 2]),
  uint32: new Uint32Array([4294967295, 1, 2]),
  float16: typeof Float16Array === "function" ? new Float16Array([1.5, 1, 2]) : new Float32Array([1.5, 1, 2]),
  float32: new Float32Array([2.5, NaN, 2]),
  float64: new Float64Array([3.5, NaN, -0]),
  bigint: new BigInt64Array([-1n, 1n, 2n]),
  biguint: new BigUint64Array([1n, 1n, 2n]),
  resizable: new Uint8Array(new ArrayBuffer(4, { maxByteLength: 8 })),
  offset: new Int32Array(buffer, 8, 2),
  buffer: Buffer.from([9, 8, 7]),
  dataView: new DataView(buffer),
  arrayBuffer: buffer,
  plain: { 0: "zero", 1: "one" },
  empty: {},
  inherited: Object.create([4, 5, 6]),
  map: new Map([[0, "no"]]),
  fn: function (a) {},
  args: (function () {
    return arguments;
  })(1, 2),
  boxed: new String("box"),
  date: new Date(0),
  proxy: new Proxy({}, { get: (_, key) => "trap " + String(key) }),
  getter: {
    get 0() {
      return "got";
    },
  },
};
const show = value => (Object.is(value, -0) ? "-0" : typeof value === "function" ? "function" : String(value));
for (const [name, object] of Object.entries(sources)) {
  const source = hide(object);
  let last = [];
  for (let round = 0; round < 800; round++) last = [at(source, 0), at(source, 1), at(source, 2), at(source, 99), at(source, -1)];
  console.log(name, last.map(show).join(" "));
}
const shrinking = new Uint8Array(new ArrayBuffer(4, { maxByteLength: 8 }));
shrinking[3] = 5;
console.log(at(shrinking, 3));
shrinking.buffer.resize(2);
console.log(at(shrinking, 3));
const moved = new ArrayBuffer(4);
const view = new Uint8Array(moved);
view[0] = 1;
console.log(at(view, 0));
moved.transfer();
console.log(at(view, 0), view.length);
for (const value of [null, undefined, 1, true, "text", Symbol("s"), 1n]) {
  try {
    console.log(show(at(hide(value), 0)));
  } catch (error) {
    console.log(error.name);
  }
}
// An integer that does not fit in 32 bits reaches the read as an index too.
function far(view, first, stride, k) {
  first |= 0;
  stride |= 0;
  k |= 0;
  return view[first + k * stride];
}
const near = hide(new Int32Array([10, 20, 30, 40]));
let reads = [];
for (let round = 0; round < 3000; round++) {
  reads = [far(near, 1, 0, 0), far(near, 1, 65536, 65536), far(near, 0, 2147483647, 2), far(near, -2147483648, 2147483647, 2), far(near, -2147483648, -2147483648, 1)];
}
console.log(reads.map(String).join(" "));
