const report = value => console.log(typeof value === "string" ? value : String(value));
// Generated: classes that share a prototype object, a kind of cell or a row of classes, each asked about the values of all.
const show = (value) => value === true ? "1" : value === false ? "0" : String(value);
function attempt(act) { try { return act(); } catch (error) { return "T"; } }
function maybe(name, make, values) { try { values.push([name, make()]); } catch (error) { values.push([name + ", which cannot be made: " + error.name, undefined]); } }

function isUint8Array(x) { return x instanceof Uint8Array; }
function countUint8Array(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Uint8Array) count++; } return count; }
function isInt8Array(x) { return x instanceof Int8Array; }
function countInt8Array(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Int8Array) count++; } return count; }
function isUint8ClampedArray(x) { return x instanceof Uint8ClampedArray; }
function countUint8ClampedArray(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Uint8ClampedArray) count++; } return count; }
function isUint16Array(x) { return x instanceof Uint16Array; }
function countUint16Array(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Uint16Array) count++; } return count; }
function isInt16Array(x) { return x instanceof Int16Array; }
function countInt16Array(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Int16Array) count++; } return count; }
function isUint32Array(x) { return x instanceof Uint32Array; }
function countUint32Array(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Uint32Array) count++; } return count; }
function isInt32Array(x) { return x instanceof Int32Array; }
function countInt32Array(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Int32Array) count++; } return count; }
function isFloat16Array(x) { return x instanceof Float16Array; }
function countFloat16Array(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Float16Array) count++; } return count; }
function isFloat32Array(x) { return x instanceof Float32Array; }
function countFloat32Array(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Float32Array) count++; } return count; }
function isFloat64Array(x) { return x instanceof Float64Array; }
function countFloat64Array(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Float64Array) count++; } return count; }
function isBigInt64Array(x) { return x instanceof BigInt64Array; }
function countBigInt64Array(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof BigInt64Array) count++; } return count; }
function isBigUint64Array(x) { return x instanceof BigUint64Array; }
function countBigUint64Array(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof BigUint64Array) count++; } return count; }
function isDataView(x) { return x instanceof DataView; }
function countDataView(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof DataView) count++; } return count; }
function isArrayBuffer(x) { return x instanceof ArrayBuffer; }
function countArrayBuffer(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof ArrayBuffer) count++; } return count; }
function isSharedArrayBuffer(x) { return x instanceof SharedArrayBuffer; }
function countSharedArrayBuffer(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof SharedArrayBuffer) count++; } return count; }
function isBuffer(x) { return x instanceof Buffer; }
function countBuffer(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Buffer) count++; } return count; }
const tests = [["Uint8Array", isUint8Array, countUint8Array], ["Int8Array", isInt8Array, countInt8Array], ["Uint8ClampedArray", isUint8ClampedArray, countUint8ClampedArray], ["Uint16Array", isUint16Array, countUint16Array], ["Int16Array", isInt16Array, countInt16Array], ["Uint32Array", isUint32Array, countUint32Array], ["Int32Array", isInt32Array, countInt32Array], ["Float16Array", isFloat16Array, countFloat16Array], ["Float32Array", isFloat32Array, countFloat32Array], ["Float64Array", isFloat64Array, countFloat64Array], ["BigInt64Array", isBigInt64Array, countBigInt64Array], ["BigUint64Array", isBigUint64Array, countBigUint64Array], ["DataView", isDataView, countDataView], ["ArrayBuffer", isArrayBuffer, countArrayBuffer], ["SharedArrayBuffer", isSharedArrayBuffer, countSharedArrayBuffer], ["Buffer", isBuffer, countBuffer]];
const values = [];
maybe("created below Uint8Array.prototype", () => Object.create(Uint8Array.prototype), values);
maybe("Uint8Array.prototype", () => Uint8Array.prototype, values);
maybe("Uint8Array", () => Uint8Array, values);
maybe("new Uint8Array", () => new Uint8Array(2), values);
maybe("new of a class below Uint8Array", () => new (class extends Uint8Array {})(2), values);
maybe("new Uint8Array without its prototype", () => Object.setPrototypeOf(new Uint8Array(2), null), values);
maybe("new Uint8Array below Int8Array.prototype", () => Object.setPrototypeOf(new Uint8Array(2), Int8Array.prototype), values);
maybe("a proxy of new Uint8Array", () => new Proxy(new Uint8Array(2), {}), values);
maybe("Uint8Array made for Int8Array as new.target", () => Reflect.construct(Uint8Array, [2], Int8Array), values);
maybe("created below Int8Array.prototype", () => Object.create(Int8Array.prototype), values);
maybe("Int8Array.prototype", () => Int8Array.prototype, values);
maybe("Int8Array", () => Int8Array, values);
maybe("new Int8Array", () => new Int8Array(2), values);
maybe("new of a class below Int8Array", () => new (class extends Int8Array {})(2), values);
maybe("new Int8Array without its prototype", () => Object.setPrototypeOf(new Int8Array(2), null), values);
maybe("new Int8Array below Uint8ClampedArray.prototype", () => Object.setPrototypeOf(new Int8Array(2), Uint8ClampedArray.prototype), values);
maybe("a proxy of new Int8Array", () => new Proxy(new Int8Array(2), {}), values);
maybe("Int8Array made for Uint8ClampedArray as new.target", () => Reflect.construct(Int8Array, [2], Uint8ClampedArray), values);
maybe("created below Uint8ClampedArray.prototype", () => Object.create(Uint8ClampedArray.prototype), values);
maybe("Uint8ClampedArray.prototype", () => Uint8ClampedArray.prototype, values);
maybe("Uint8ClampedArray", () => Uint8ClampedArray, values);
maybe("new Uint8ClampedArray", () => new Uint8ClampedArray(2), values);
maybe("new of a class below Uint8ClampedArray", () => new (class extends Uint8ClampedArray {})(2), values);
maybe("new Uint8ClampedArray without its prototype", () => Object.setPrototypeOf(new Uint8ClampedArray(2), null), values);
maybe("new Uint8ClampedArray below Uint16Array.prototype", () => Object.setPrototypeOf(new Uint8ClampedArray(2), Uint16Array.prototype), values);
maybe("a proxy of new Uint8ClampedArray", () => new Proxy(new Uint8ClampedArray(2), {}), values);
maybe("Uint8ClampedArray made for Uint16Array as new.target", () => Reflect.construct(Uint8ClampedArray, [2], Uint16Array), values);
maybe("created below Uint16Array.prototype", () => Object.create(Uint16Array.prototype), values);
maybe("Uint16Array.prototype", () => Uint16Array.prototype, values);
maybe("Uint16Array", () => Uint16Array, values);
maybe("new Uint16Array", () => new Uint16Array(2), values);
maybe("new of a class below Uint16Array", () => new (class extends Uint16Array {})(2), values);
maybe("new Uint16Array without its prototype", () => Object.setPrototypeOf(new Uint16Array(2), null), values);
maybe("new Uint16Array below Int16Array.prototype", () => Object.setPrototypeOf(new Uint16Array(2), Int16Array.prototype), values);
maybe("a proxy of new Uint16Array", () => new Proxy(new Uint16Array(2), {}), values);
maybe("Uint16Array made for Int16Array as new.target", () => Reflect.construct(Uint16Array, [2], Int16Array), values);
maybe("created below Int16Array.prototype", () => Object.create(Int16Array.prototype), values);
maybe("Int16Array.prototype", () => Int16Array.prototype, values);
maybe("Int16Array", () => Int16Array, values);
maybe("new Int16Array", () => new Int16Array(2), values);
maybe("new of a class below Int16Array", () => new (class extends Int16Array {})(2), values);
maybe("new Int16Array without its prototype", () => Object.setPrototypeOf(new Int16Array(2), null), values);
maybe("new Int16Array below Uint32Array.prototype", () => Object.setPrototypeOf(new Int16Array(2), Uint32Array.prototype), values);
maybe("a proxy of new Int16Array", () => new Proxy(new Int16Array(2), {}), values);
maybe("Int16Array made for Uint32Array as new.target", () => Reflect.construct(Int16Array, [2], Uint32Array), values);
maybe("created below Uint32Array.prototype", () => Object.create(Uint32Array.prototype), values);
maybe("Uint32Array.prototype", () => Uint32Array.prototype, values);
maybe("Uint32Array", () => Uint32Array, values);
maybe("new Uint32Array", () => new Uint32Array(2), values);
maybe("new of a class below Uint32Array", () => new (class extends Uint32Array {})(2), values);
maybe("new Uint32Array without its prototype", () => Object.setPrototypeOf(new Uint32Array(2), null), values);
maybe("new Uint32Array below Int32Array.prototype", () => Object.setPrototypeOf(new Uint32Array(2), Int32Array.prototype), values);
maybe("a proxy of new Uint32Array", () => new Proxy(new Uint32Array(2), {}), values);
maybe("Uint32Array made for Int32Array as new.target", () => Reflect.construct(Uint32Array, [2], Int32Array), values);
maybe("created below Int32Array.prototype", () => Object.create(Int32Array.prototype), values);
maybe("Int32Array.prototype", () => Int32Array.prototype, values);
maybe("Int32Array", () => Int32Array, values);
maybe("new Int32Array", () => new Int32Array(2), values);
maybe("new of a class below Int32Array", () => new (class extends Int32Array {})(2), values);
maybe("new Int32Array without its prototype", () => Object.setPrototypeOf(new Int32Array(2), null), values);
maybe("new Int32Array below Float16Array.prototype", () => Object.setPrototypeOf(new Int32Array(2), Float16Array.prototype), values);
maybe("a proxy of new Int32Array", () => new Proxy(new Int32Array(2), {}), values);
maybe("Int32Array made for Float16Array as new.target", () => Reflect.construct(Int32Array, [2], Float16Array), values);
maybe("created below Float16Array.prototype", () => Object.create(Float16Array.prototype), values);
maybe("Float16Array.prototype", () => Float16Array.prototype, values);
maybe("Float16Array", () => Float16Array, values);
maybe("new Float16Array", () => new Float16Array(2), values);
maybe("new of a class below Float16Array", () => new (class extends Float16Array {})(2), values);
maybe("new Float16Array without its prototype", () => Object.setPrototypeOf(new Float16Array(2), null), values);
maybe("new Float16Array below Float32Array.prototype", () => Object.setPrototypeOf(new Float16Array(2), Float32Array.prototype), values);
maybe("a proxy of new Float16Array", () => new Proxy(new Float16Array(2), {}), values);
maybe("Float16Array made for Float32Array as new.target", () => Reflect.construct(Float16Array, [2], Float32Array), values);
maybe("created below Float32Array.prototype", () => Object.create(Float32Array.prototype), values);
maybe("Float32Array.prototype", () => Float32Array.prototype, values);
maybe("Float32Array", () => Float32Array, values);
maybe("new Float32Array", () => new Float32Array(2), values);
maybe("new of a class below Float32Array", () => new (class extends Float32Array {})(2), values);
maybe("new Float32Array without its prototype", () => Object.setPrototypeOf(new Float32Array(2), null), values);
maybe("new Float32Array below Float64Array.prototype", () => Object.setPrototypeOf(new Float32Array(2), Float64Array.prototype), values);
maybe("a proxy of new Float32Array", () => new Proxy(new Float32Array(2), {}), values);
maybe("Float32Array made for Float64Array as new.target", () => Reflect.construct(Float32Array, [2], Float64Array), values);
maybe("created below Float64Array.prototype", () => Object.create(Float64Array.prototype), values);
maybe("Float64Array.prototype", () => Float64Array.prototype, values);
maybe("Float64Array", () => Float64Array, values);
maybe("new Float64Array", () => new Float64Array(2), values);
maybe("new of a class below Float64Array", () => new (class extends Float64Array {})(2), values);
maybe("new Float64Array without its prototype", () => Object.setPrototypeOf(new Float64Array(2), null), values);
maybe("new Float64Array below BigInt64Array.prototype", () => Object.setPrototypeOf(new Float64Array(2), BigInt64Array.prototype), values);
maybe("a proxy of new Float64Array", () => new Proxy(new Float64Array(2), {}), values);
maybe("Float64Array made for BigInt64Array as new.target", () => Reflect.construct(Float64Array, [2], BigInt64Array), values);
maybe("created below BigInt64Array.prototype", () => Object.create(BigInt64Array.prototype), values);
maybe("BigInt64Array.prototype", () => BigInt64Array.prototype, values);
maybe("BigInt64Array", () => BigInt64Array, values);
maybe("new BigInt64Array", () => new BigInt64Array(2), values);
maybe("new of a class below BigInt64Array", () => new (class extends BigInt64Array {})(2), values);
maybe("new BigInt64Array without its prototype", () => Object.setPrototypeOf(new BigInt64Array(2), null), values);
maybe("new BigInt64Array below BigUint64Array.prototype", () => Object.setPrototypeOf(new BigInt64Array(2), BigUint64Array.prototype), values);
maybe("a proxy of new BigInt64Array", () => new Proxy(new BigInt64Array(2), {}), values);
maybe("BigInt64Array made for BigUint64Array as new.target", () => Reflect.construct(BigInt64Array, [2], BigUint64Array), values);
maybe("created below BigUint64Array.prototype", () => Object.create(BigUint64Array.prototype), values);
maybe("BigUint64Array.prototype", () => BigUint64Array.prototype, values);
maybe("BigUint64Array", () => BigUint64Array, values);
maybe("new BigUint64Array", () => new BigUint64Array(2), values);
maybe("new of a class below BigUint64Array", () => new (class extends BigUint64Array {})(2), values);
maybe("new BigUint64Array without its prototype", () => Object.setPrototypeOf(new BigUint64Array(2), null), values);
maybe("new BigUint64Array below DataView.prototype", () => Object.setPrototypeOf(new BigUint64Array(2), DataView.prototype), values);
maybe("a proxy of new BigUint64Array", () => new Proxy(new BigUint64Array(2), {}), values);
maybe("BigUint64Array made for DataView as new.target", () => Reflect.construct(BigUint64Array, [2], DataView), values);
maybe("created below DataView.prototype", () => Object.create(DataView.prototype), values);
maybe("DataView.prototype", () => DataView.prototype, values);
maybe("DataView", () => DataView, values);
maybe("new DataView", () => new DataView(new ArrayBuffer(8)), values);
maybe("new of a class below DataView", () => new (class extends DataView {})(new ArrayBuffer(8)), values);
maybe("new DataView without its prototype", () => Object.setPrototypeOf(new DataView(new ArrayBuffer(8)), null), values);
maybe("new DataView below ArrayBuffer.prototype", () => Object.setPrototypeOf(new DataView(new ArrayBuffer(8)), ArrayBuffer.prototype), values);
maybe("a proxy of new DataView", () => new Proxy(new DataView(new ArrayBuffer(8)), {}), values);
maybe("DataView made for ArrayBuffer as new.target", () => Reflect.construct(DataView, [new ArrayBuffer(8)], ArrayBuffer), values);
maybe("created below ArrayBuffer.prototype", () => Object.create(ArrayBuffer.prototype), values);
maybe("ArrayBuffer.prototype", () => ArrayBuffer.prototype, values);
maybe("ArrayBuffer", () => ArrayBuffer, values);
maybe("new ArrayBuffer", () => new ArrayBuffer(8), values);
maybe("new of a class below ArrayBuffer", () => new (class extends ArrayBuffer {})(8), values);
maybe("new ArrayBuffer without its prototype", () => Object.setPrototypeOf(new ArrayBuffer(8), null), values);
maybe("new ArrayBuffer below SharedArrayBuffer.prototype", () => Object.setPrototypeOf(new ArrayBuffer(8), SharedArrayBuffer.prototype), values);
maybe("a proxy of new ArrayBuffer", () => new Proxy(new ArrayBuffer(8), {}), values);
maybe("ArrayBuffer made for SharedArrayBuffer as new.target", () => Reflect.construct(ArrayBuffer, [8], SharedArrayBuffer), values);
maybe("created below SharedArrayBuffer.prototype", () => Object.create(SharedArrayBuffer.prototype), values);
maybe("SharedArrayBuffer.prototype", () => SharedArrayBuffer.prototype, values);
maybe("SharedArrayBuffer", () => SharedArrayBuffer, values);
maybe("new SharedArrayBuffer", () => new SharedArrayBuffer(8), values);
maybe("new of a class below SharedArrayBuffer", () => new (class extends SharedArrayBuffer {})(8), values);
maybe("new SharedArrayBuffer without its prototype", () => Object.setPrototypeOf(new SharedArrayBuffer(8), null), values);
maybe("new SharedArrayBuffer below Buffer.prototype", () => Object.setPrototypeOf(new SharedArrayBuffer(8), Buffer.prototype), values);
maybe("a proxy of new SharedArrayBuffer", () => new Proxy(new SharedArrayBuffer(8), {}), values);
maybe("SharedArrayBuffer made for Buffer as new.target", () => Reflect.construct(SharedArrayBuffer, [8], Buffer), values);
maybe("created below Buffer.prototype", () => Object.create(Buffer.prototype), values);
maybe("Buffer.prototype", () => Buffer.prototype, values);
maybe("Buffer", () => Buffer, values);
maybe("new Buffer", () => new Buffer(2), values);
maybe("new of a class below Buffer", () => new (class extends Buffer {})(2), values);
maybe("new Buffer without its prototype", () => Object.setPrototypeOf(new Buffer(2), null), values);
maybe("new Buffer below Uint8Array.prototype", () => Object.setPrototypeOf(new Buffer(2), Uint8Array.prototype), values);
maybe("a proxy of new Buffer", () => new Proxy(new Buffer(2), {}), values);
maybe("Buffer made for Uint8Array as new.target", () => Reflect.construct(Buffer, [2], Uint8Array), values);
maybe(`Buffer.from("ab")`, () => (Buffer.from("ab")), values);
maybe("Buffer.alloc(2)", () => (Buffer.alloc(2)), values);
maybe(`Buffer.from("ab").subarray(1)`, () => (Buffer.from("ab").subarray(1)), values);
maybe(`new Uint8Array(Buffer.from("ab").buffer)`, () => (new Uint8Array(Buffer.from("ab").buffer)), values);
maybe(`Buffer.from("ab").buffer`, () => (Buffer.from("ab").buffer), values);
maybe("new Uint8Array(2).subarray(1)", () => (new Uint8Array(2).subarray(1)), values);
maybe(`new TextEncoder().encode("a")`, () => (new TextEncoder().encode("a")), values);
maybe("new Uint8Array(new SharedArrayBuffer(8))", () => (new Uint8Array(new SharedArrayBuffer(8))), values);
maybe("new ArrayBuffer(8, { maxByteLength: 16 })", () => (new ArrayBuffer(8, { maxByteLength: 16 })), values);
maybe("new ArrayBuffer(8).transfer()", () => (new ArrayBuffer(8).transfer()), values);
maybe("[1, 2]", () => ([1, 2]), values);
for (const [name, value] of values) {
  let answers = "";
  for (const [, is, count] of tests) answers += show(attempt(() => is(value))) + show(attempt(() => count(value)));
  report(answers + " " + name);
}
const ordinary = Function.prototype[Symbol.hasInstance];
report("Uint8Array: " + (Uint8Array[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Uint8Array, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Uint8Array, value))) + show(attempt(() => Uint8Array[Symbol.hasInstance](value)))).join(""));
report("Int8Array: " + (Int8Array[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Int8Array, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Int8Array, value))) + show(attempt(() => Int8Array[Symbol.hasInstance](value)))).join(""));
report("Uint8ClampedArray: " + (Uint8ClampedArray[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Uint8ClampedArray, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Uint8ClampedArray, value))) + show(attempt(() => Uint8ClampedArray[Symbol.hasInstance](value)))).join(""));
report("Uint16Array: " + (Uint16Array[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Uint16Array, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Uint16Array, value))) + show(attempt(() => Uint16Array[Symbol.hasInstance](value)))).join(""));
report("Int16Array: " + (Int16Array[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Int16Array, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Int16Array, value))) + show(attempt(() => Int16Array[Symbol.hasInstance](value)))).join(""));
report("Uint32Array: " + (Uint32Array[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Uint32Array, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Uint32Array, value))) + show(attempt(() => Uint32Array[Symbol.hasInstance](value)))).join(""));
report("Int32Array: " + (Int32Array[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Int32Array, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Int32Array, value))) + show(attempt(() => Int32Array[Symbol.hasInstance](value)))).join(""));
report("Float16Array: " + (Float16Array[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Float16Array, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Float16Array, value))) + show(attempt(() => Float16Array[Symbol.hasInstance](value)))).join(""));
report("Float32Array: " + (Float32Array[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Float32Array, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Float32Array, value))) + show(attempt(() => Float32Array[Symbol.hasInstance](value)))).join(""));
report("Float64Array: " + (Float64Array[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Float64Array, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Float64Array, value))) + show(attempt(() => Float64Array[Symbol.hasInstance](value)))).join(""));
report("BigInt64Array: " + (BigInt64Array[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(BigInt64Array, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(BigInt64Array, value))) + show(attempt(() => BigInt64Array[Symbol.hasInstance](value)))).join(""));
report("BigUint64Array: " + (BigUint64Array[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(BigUint64Array, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(BigUint64Array, value))) + show(attempt(() => BigUint64Array[Symbol.hasInstance](value)))).join(""));
report("DataView: " + (DataView[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(DataView, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(DataView, value))) + show(attempt(() => DataView[Symbol.hasInstance](value)))).join(""));
report("ArrayBuffer: " + (ArrayBuffer[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(ArrayBuffer, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(ArrayBuffer, value))) + show(attempt(() => ArrayBuffer[Symbol.hasInstance](value)))).join(""));
report("SharedArrayBuffer: " + (SharedArrayBuffer[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(SharedArrayBuffer, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(SharedArrayBuffer, value))) + show(attempt(() => SharedArrayBuffer[Symbol.hasInstance](value)))).join(""));
report("Buffer: " + (Buffer[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Buffer, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Buffer, value))) + show(attempt(() => Buffer[Symbol.hasInstance](value)))).join(""));
process.exit(0);
