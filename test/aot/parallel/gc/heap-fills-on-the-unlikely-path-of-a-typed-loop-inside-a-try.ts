// The list is declared to hold numbers, so the likely iterations of the loop allocate nothing. With objects in it every iteration throws a TypeError, catches it and keeps it, until the heap is full.
// The loop is inside a try block, whose catch clause gets the RangeError.
// Env: BUN_JSC_markedBlockCageSizeInMB=64
// Alone: how much fits in the 64 MB heap depends on what else the executable holds
class Box {
  #secret = 1;
  static read(value: any): number {
    return value.#secret;
  }
}
class Holder {
  error: any = null;
}
const odd = {
  valueOf() {
    return Box.read(this);
  },
};
function run(holders: Holder[], values: number[]): string {
  let sum = 0;
  try {
    for (let index = 0; index < holders.length; index++) {
      try {
        sum += values[index & 1];
      } catch (error) {
        holders[index].error = error;
      }
    }
    return "returned " + sum;
  } catch (error) {
    return "caught " + (error as Error).name;
  }
}
const holders: Holder[] = [];
for (let index = 0; index < 600_000; index++) holders.push(new Holder());
console.log(run(holders, JSON.parse("[1, 2]")));
console.log(run(holders, [odd, odd] as unknown as number[]));
/* Output:
returned 900000
caught RangeError
*/
