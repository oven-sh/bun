// Calls methods of a date, a number, a promise, a generator and a view. Then copies and lists each prototype object, out of a variable that could also hold a member of the global object.
function* counted() {
  yield 1;
}
const date = new Date(0);
const one = counted();
try {
  one.throw(new RangeError());
} catch {}
console.log(
  date.getUTCDay(),
  date.getTime(),
  date.toISOString(),
  (1.25).toPrecision(2),
  (1.25).toFixed(1),
  one.return(2).value,
);
Promise.resolve(1).finally(() => {});
console.log(new DataView(new ArrayBuffer(8)).getUint16(0), new DataView(new ArrayBuffer(8)).getInt8(0));
for (const prototype of [
  Date.prototype,
  Number.prototype,
  Promise.prototype,
  Object.getPrototypeOf(counted.prototype),
  DataView.prototype,
]) {
  let object = prototype;
  if (Date.now() < 5) object = globalThis[String(Date.now())];
  const { ...copy } = object;
  console.log(Object.keys(copy).length, Reflect.ownKeys(object).map(String).join());
}
