// The built-in reads its receiver: called off the record, that is the record.
type Bag = { length: number; add: (...items: number[]) => number; [index: number]: number };
function fill(bag: Bag, times: number): number {
  let last = 0;
  for (let i = 0; i < times; i++) last = bag.add(i);
  return last;
}
function main() {
  const native: Bag = { length: 0, add: Array.prototype.push };
  const own: Bag = { length: 0, add(...items: number[]) { this.length += items.length * 2; return -this.length; } };
  console.log(fill(native, 300), native.length, native[299], fill(own, 300), own.length);
}
main();
