// The lazy getter: the first read lays a value over the accessor that computed it. Another object gets another getter by a descriptor.
type Lazy = { runs: number; value: number };
function read(lazy: Lazy): number { return lazy.value; }
function make(): Lazy {
  return { runs: 0, get value(): number { this.runs++; const computed = 40 + this.runs; Object.defineProperty(this, "value", { value: computed, writable: true, enumerable: true, configurable: true }); return computed; } };
}
function main() {
  const lazy = make(), other = make();
  let sum = 0;
  for (let i = 0; i < 300; i++) sum += read(lazy);
  Object.defineProperty(other, "value", { get() { return -1; }, configurable: true });
  let otherSum = 0;
  for (let i = 0; i < 300; i++) otherSum += read(other);
  console.log(sum, lazy.runs, otherSum, other.runs, typeof Object.getOwnPropertyDescriptor(lazy, "value")!.get);
}
main();
