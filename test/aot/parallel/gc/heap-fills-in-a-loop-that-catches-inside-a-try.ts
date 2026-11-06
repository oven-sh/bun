// Every iteration throws a TypeError, catches it and keeps it, until the heap is full. The loop is inside a try block, whose catch clause gets the RangeError.
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
function run(holders: Holder[], wrong: object): string {
  try {
    for (let index = 0; index < holders.length; index++) {
      let thrown: any = null;
      try {
        Box.read(wrong);
      } catch (error) {
        thrown = error;
      }
      holders[index].error = thrown;
    }
    return "returned";
  } catch (error) {
    return "caught " + (error as Error).name;
  }
}
const holders: Holder[] = [];
for (let index = 0; index < 600_000; index++) holders.push(new Holder());
console.log(run(holders, {}));
/* Output:
caught RangeError
*/
