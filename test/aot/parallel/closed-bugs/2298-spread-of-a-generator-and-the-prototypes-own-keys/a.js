function* counted() {
  yield 1;
}
const listed = Object.getPrototypeOf(counted.prototype);
console.log([...counted()].length);
try {
  counted().throw(new RangeError());
} catch {}
console.log(Object.keys({ ...listed }).length);
console.log(Reflect.ownKeys(listed).map(String).join());
