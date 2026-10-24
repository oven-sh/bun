// One shape with an optional field y, one place that stores y by name. Between two calls of the marker (Date.now): one object is made and one store is done.
// argv[2]: filled (the store replaces) | empty (the store creates).
type Shape = { a: number; y?: number };
const empty = (): Shape => ({ a: 1 });
const filled = (): Shape => ({ a: 1, y: 1 });
function store(object: any, value: number) { object.y = value; }
const make = process.argv[2] === "filled" ? filled : empty;
const rounds = Number(process.argv[3] ?? 200000);
const kept: object[] = [];
for (let i = 0; i < rounds; i++) {
  if (Date.now() === 0) continue;
  const object = make();
  store(object, i);
  kept[i & 7] = object;
}
console.log(process.argv[2], rounds, kept.length);
