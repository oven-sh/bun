var { Memory } = WebAssembly;
var page = 65536;

var range32 = "Expect an integer argument in the range: [0, 2^32 - 1]";
for (var [kind, message, descriptor] of [
  [TypeError, "WebAssembly.Memory expects its first argument to be an object", 1],
  [TypeError, range32, {}],
  [TypeError, range32, { initial: -1 }],
  [TypeError, range32, { initial: 2 ** 32 }],
  [TypeError, range32, { initial: 0, maximum: NaN }],
  [TypeError, "Expect an integer argument in the range: [0, 2^64 - 1]", { address: "i64", initial: -1n }],
  [TypeError, "WebAssembly.Memory 'address' must be a string of value 'i32' or 'i64'", { address: "i16" }],
  [TypeError, "WebAssembly.Memory 'initial' and 'minimum' options are specified at the same time", { initial: 1, minimum: 1 }],
  [RangeError, "WebAssembly.Memory 'initial' page count is too large", { initial: 65537 }],
  [RangeError, "WebAssembly.Memory 'maximum' page count is too large", { initial: 0, maximum: 65537 }],
  [RangeError, "'maximum' page count must be than greater than or equal to the 'initial' page count", { initial: 2, maximum: 1 }],
  [TypeError, "'maximum' page count must be defined if 'shared' is true", { initial: 1, shared: true }],
  [RangeError, "Out of memory", { address: "i64", initial: 65537n }],
]) {
  throws(kind, message, () => new Memory(descriptor));
}

var log = [];
new Memory(logging(log, { minimum: -0.5 }));
assertDeepEq(log, ["address", "initial", "minimum", "maximum", "shared"]);

for (var method of ["grow", "type", "toFixedLengthBuffer", "toResizableBuffer"]) {
  var message = "WebAssembly.Memory.prototype.buffer getter called with non WebAssembly.Memory |this| value";
  throws(TypeError, message, () => Memory.prototype[method].call({}));
}

// Any growth detaches a buffer of fixed length.
var memory = new Memory({ initial: 1, maximum: 5 });
for (var delta of [1, 0]) {
  var old = memory.buffer;
  var view = new Uint8Array(old);
  view[page - 1] = 9;
  assertEq(memory.buffer, old);
  assertEq(memory.toFixedLengthBuffer(), old);
  throws(TypeError, "Receiver cannot be detached because it is WebAssembly.Memory", () => old.transfer());
  assertEq(memory.grow(delta), 2 - delta);
  assertDeepEq([old.detached, old.byteLength, view.length, memory.buffer.byteLength], [true, 0, 0, 2 * page]);
  assertEq(new Uint8Array(memory.buffer)[page - 1], 9);
}
old = memory.buffer;
throws(RangeError, "WebAssembly.Memory.grow would exceed the memory's declared maximum size", () => memory.grow(4));
throws(RangeError, "WebAssembly.Memory.grow expects the grown size to be a valid page count", () => memory.grow(65535));
throws(TypeError, range32, () => memory.grow());
assertEq(memory.buffer, old);
assertDeepEq(memory.type(), { maximum: 5, minimum: 2, shared: false, address: "i32" });

// A resizable one follows the memory, and the other way round.
var resizable = memory.toResizableBuffer();
var tracking = new Uint8Array(resizable);
assertDeepEq([old.detached, resizable.resizable, resizable.maxByteLength], [true, true, 5 * page]);
assertEq(memory.toResizableBuffer(), resizable);
memory.grow(1);
assertEq(memory.buffer, resizable);
assertDeepEq([tracking.length, tracking[page - 1], tracking[3 * page - 1]], [3 * page, 9, 0]);
resizable.resize(4 * page);
assertEq(memory.grow(0), 4);
throws(RangeError, "Cannot shrink WebAssembly memory", () => resizable.resize(page));
throws(RangeError, "ArrayBuffer resize failed with new byte length 393216", () => resizable.resize(6 * page));
assertThrows(RangeError, () => resizable.resize(4 * page + 1));
var fixed = memory.toFixedLengthBuffer();
assertDeepEq([resizable.detached, tracking.length, fixed.resizable, fixed.byteLength], [true, 0, false, 4 * page]);
assertEq(new Memory({ initial: 0 }).toResizableBuffer().maxByteLength, 2 ** 32);

// So does one that starts empty, when WebAssembly grows the memory.
var growing = new Builder().importMemory("env", "memory", 0);
growing.addExport("grow", kExternFunc, growing.addFunction(growing.addType([kI32], [kI32]), [], [0x20, 0, 0x40, 0]));
for (var address of ["i32", "i64"]) {
  var count = address === "i32" ? Number : BigInt;
  memory = new Memory({ address, initial: count(0) });
  var grow = address === "i32" ? growing.instantiate({ env: { memory } }).grow : it => memory.grow(it);
  tracking = new Uint8Array(memory.toResizableBuffer());
  for (var pages = 0; pages < 20; pages++) {
    assertEq(grow(count(1)), count(pages));
    tracking[pages * page] = pages + 1;
    assertDeepEq([tracking.length, tracking[0]], [(pages + 1) * page, 1]);
  }
}
throws(RangeError, "WebAssembly.Memory.grow expects the delta to be a valid page count", () => memory.grow(2n ** 48n + 1n));
throws(RangeError, "Out of memory", () => memory.grow(65536n));
assertEq(memory.type().minimum, 20n);

// Buffers of a shared memory are frozen and stay.
var shared = new Memory({ initial: 1, maximum: 4, shared: true });
var first = shared.buffer;
assert(first instanceof SharedArrayBuffer && Object.isFrozen(first) && !first.growable);
assertEq(shared.grow(0), 1);
assertEq(shared.buffer, first);
shared.grow(1);
var second = shared.buffer;
assertDeepEq([first.byteLength, second.byteLength], [page, 2 * page]);
new Uint8Array(first)[0] = 3;
assertEq(new Uint8Array(second)[0], 3);
var growable = shared.toResizableBuffer();
assert(Object.isFrozen(growable) && growable.growable);
growable.grow(3 * page);
assertEq(shared.buffer, growable);
assertThrows(RangeError, () => growable.grow(3 * page + 1));
assertThrows(RangeError, () => growable.grow(page));

// Growth that goes past the object is seen too.
shared.toFixedLengthBuffer();
growable.grow(4 * page);
assertEq(shared.buffer.byteLength, 4 * page);
assertEq(new Memory({ initial: 0, maximum: 0, shared: true }).buffer.byteLength, 0);

// Whoever waits is not forgotten with a buffer.
var waiting = Atomics.waitAsync(new Int32Array(first), 1, 0).value;
for (var index = 0; index < 2000; index++) shared.toResizableBuffer(), shared.toFixedLengthBuffer();
assertEq(Atomics.notify(new Int32Array(shared.buffer), 1), 1);
runAsync(async () => assertEq(await waiting, "ok"));

// A place that reads the buffer often sees each new one.
var read = it => it.buffer;
var kinds = [new Memory({ initial: 0 }), new Memory({ initial: 0, maximum: 100, shared: true }), new (class extends Memory {})({ initial: 0 })];
for (var index = 0; index < 6000; index++) {
  memory = kinds[index % 3];
  if (index % 100 < 3) memory.grow(1);
  if (index % 700 < 3) memory.toResizableBuffer();
  if (index % 1100 < 3) memory.toFixedLengthBuffer();
  assertEq(read(memory).byteLength, memory.type().minimum * page);
  assertEq(read(memory), read(memory));
}
assertThrows(TypeError, () => read(Object.create(kinds[0])));
Object.defineProperty(Memory.prototype, "buffer", { get: () => "replaced" });
assertDeepEq(kinds.map(read), ["replaced", "replaced", "replaced"]);
