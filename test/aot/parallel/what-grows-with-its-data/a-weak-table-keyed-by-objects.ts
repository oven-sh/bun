// WeakMap: set and get.
// Sizes: 250 1000 4000
// Passes: 1200
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);

function once(): string {
  const notes = new WeakMap<object, number>(),
    things: { i: number }[] = [];
  for (let i = 0; i < size * 2; i++) {
    const thing = { i };
    things.push(thing);
    notes.set(thing, i & 31);
  }
  let sum = 0;
  for (const thing of things) sum += notes.get(thing)! + (notes.has(thing) ? 1 : 0);
  return [sum].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
