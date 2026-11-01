// ArrayBuffer.isView and Error.isError ask what kind of cell a value is: of twenty-eight kinds of value that nobody knows, proxies, objects under the prototypes, classes of the program below the built-in classes and a DOMException among them; once, in a loop, and with a read behind the answer.
const values = [[1, 2], { a: 1 }, new Date(0), "text", 5, null, undefined, Buffer.from("ab"), new Map(), new Error("e"), new TypeError("t"), new Uint8Array(2), new Float64Array(1), new DataView(new ArrayBuffer(2)), new ArrayBuffer(2), new BigInt64Array(1), () => 1, new Proxy(new Uint8Array(1), {}), new Proxy(new Error("p"), {}), Object.create(Error.prototype), Object.create(Uint8Array.prototype), new (class E extends Error {})("x"), new (class U extends Uint8Array {})(1), new (class D extends DataView {})(new ArrayBuffer(1)), new DOMException("d"), new AggregateError([]), Symbol("s"), 5n];
const box = { v: null }; const pick = i => { box.v = values[i % values.length]; return box.v; };
function view(x) { return ArrayBuffer.isView(x) ? 1 : 0; }
function error(x) { return Error.isError(x) ? 1 : 0; }
let views = "", errors = "", sumViews = 0, sumErrors = 0;
for (let i = 0; i < values.length; i++) { views += view(pick(i)); errors += error(pick(i)); }
for (let i = 0; i < 50000; i++) { sumViews += view(pick(i)); sumErrors += error(pick(i)); }
console.log(views, errors, sumViews, sumErrors);
function narrowed(x) { return ArrayBuffer.isView(x) ? x.byteLength : Error.isError(x) ? x.message : -1; }
console.log(values.map(narrowed).join());
