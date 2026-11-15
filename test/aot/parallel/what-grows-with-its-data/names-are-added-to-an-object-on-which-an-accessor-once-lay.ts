// An accessor laid under a name out of the compiler's sight, turned back into a value or deleted or left; then names are added, changed and taken away.
// The sizes are small: four objects of 16,000 names are some megabytes, and what a name costs then hangs on the caches of the machine, in plain Bun too. A look through the names at every store
// reads 12 at these sizes, where 4 is linear.
// Sizes: 250 1000 4000
// Passes: 96
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
class Bag {
  kind = "bag";
  [name: string]: unknown;
}
const lazy: string = JSON.parse('"lazy"');
function lay(bag: Bag): void {
  Object.defineProperty(bag, lazy, { get: () => 1, configurable: true });
}
function fill(bag: Bag): number {
  for (let i = 0; i < size; i++) bag["k" + i] = i;
  for (let i = 0; i < size; i += 2) Object.defineProperty(bag, "k" + i, { value: -i, writable: true, enumerable: true, configurable: true });
  for (let i = 1; i < size; i += 4) delete bag["k" + i];
  return Object.keys(bag).length;
}
function once(): string {
  const turnedBack = new Bag();
  lay(turnedBack);
  Object.defineProperty(turnedBack, lazy, { value: 1, writable: true, enumerable: true, configurable: true });
  const deleted = new Bag();
  lay(deleted);
  delete deleted[lazy];
  const left = new Bag();
  lay(left);
  const laidLast = new Bag();
  const counts = [fill(turnedBack), fill(deleted), fill(left), fill(laidLast)];
  lay(laidLast);
  for (let i = 3; i < size; i += 4) delete laidLast["k" + i];
  counts.push(Object.keys(laidLast).length);
  return counts.join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
