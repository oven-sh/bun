// Each iteration of run() throws a TypeError, catches it and keeps it, until the heap is full. Then it calls total(), whose loop allocates nothing and is inside a try block.
// Wherever the RangeError is thrown, the finally clause of total() runs and the catch clause of run() gets it.
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
const state = { busy: false, entered: 0, left: 0 };
function total(list: Float64Array): number {
  let sum = 0;
  state.busy = true;
  state.entered++;
  try {
    for (let index = 0; index < list.length; index++) sum += list[index];
  } finally {
    state.busy = false;
    state.left++;
  }
  return sum;
}
function run(holders: Holder[], wrong: object, list: Float64Array): string {
  let sum = 0;
  try {
    for (let index = 0; index < holders.length; index++) {
      try {
        Box.read(wrong);
      } catch (error) {
        holders[index].error = error;
      }
      sum += total(list);
    }
    return "returned " + sum;
  } catch (error) {
    return "caught " + (error as Error).name;
  }
}
const holders: Holder[] = [];
for (let index = 0; index < 600_000; index++) holders.push(new Holder());
console.log(
  run(holders, {}, new Float64Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17])),
  state.busy,
  state.entered === state.left,
);
/* Output:
caught RangeError false true
*/
