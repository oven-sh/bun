// Buffer.alloc, allocUnsafe and allocUnsafeSlow may be called with `new`: the same native function runs and does not look at new.target. `new process.nextTick(f)` queues f and answers a new ordinary object.
const kept = [];
function shown(value) {
  for (let i = 0; i < 2; i++) kept.length = Math.min(kept.length, 64);
  kept.push(value);
  if (value === null || typeof value !== "object") return value === null ? "null" : typeof value;
  return `${Object.getPrototypeOf(value)?.constructor?.name} ${value.length} ${Object.getPrototypeOf(value) === Buffer.prototype} ${Buffer.isBuffer(value)}`;
}
function tried(call) {
  try {
    return shown(call());
  } catch (error) {
    return `${Object.getPrototypeOf(error).constructor.name} ${error.code}`;
  }
}
for (const name of ["alloc", "allocUnsafe", "allocUnsafeSlow"]) {
  const made = new Buffer[name](3);
  made.fill(7);
  console.log(name, shown(made), made.readUInt8(2), made.toString("hex"), tried(() => new Buffer[name]("3")), tried(() => new Buffer[name](-1)), tried(() => new Buffer[name]()));
  console.log(tried(() => Reflect.construct(Buffer[name], [2], Map)), tried(() => Reflect.construct(Buffer[name], [2], class extends Buffer {})));
}
console.log(shown(new Buffer.alloc(4, "ab")), new Buffer.alloc(4, "ab").toString(), new Buffer.alloc(4, new Uint8Array([1, 2])).toString("hex"), new Buffer.alloc(3, "YQ==", "base64").toString());
console.log(tried(() => new Buffer.concat([])), tried(() => new Buffer.byteLength("a")));
const ticked = new process.nextTick((...operands) => console.log("ticked", operands.join()), 1, 2);
console.log(typeof ticked, Object.keys(ticked).length, Object.prototype.toString.call(ticked), ticked instanceof Object, tried(() => new process.nextTick(1)));
console.log(Object.getPrototypeOf(ticked) === Object.prototype, Object.getPrototypeOf(ticked) === process.nextTick.prototype, ticked.constructor === Object, typeof ticked.hasOwnProperty);
ticked.label = "stored by the program";
console.log(ticked.label, kept.length > 0);
