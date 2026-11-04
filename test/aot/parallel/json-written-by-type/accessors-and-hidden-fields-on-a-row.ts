// a getter is laid over a field of a row, with a side effect that shows how often it runs; another field is made not enumerable; a getter deletes the key behind it
// COUNT: operation:operationAOTStringBuilderBegin >= 1
type Row = { id: number; name: string; tail: string };
function write(row: Row): string {
  return JSON.stringify(row);
}
function make(id: number): Row {
  return { id, name: "n" + id, tail: "t" };
}
let reads = 0;
for (let i = 0; i < 3; i++) console.log(write(make(i)));
const watched = make(4);
Object.defineProperty(watched, "name", { get: () => "read " + ++reads, enumerable: true, configurable: true });
console.log(write(watched), reads);
console.log(write(watched), reads);
const hidden = make(5);
Object.defineProperty(hidden, "name", { enumerable: false });
console.log(write(hidden));
const shrinking = make(6);
Object.defineProperty(shrinking, "name", {
  get() {
    delete (shrinking as any).tail;
    return "deletes";
  },
  enumerable: true,
});
console.log(write(shrinking), Object.keys(shrinking).join());
const throwing = make(7);
Object.defineProperty(throwing, "id", {
  get() {
    throw new RangeError("from the getter");
  },
  enumerable: true,
});
try {
  console.log(write(throwing));
} catch (e) {
  console.log((e as Error).name, (e as Error).message);
}
console.log(write(make(8)));
