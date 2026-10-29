// Every turn of a loop over a long list throws, catches and keeps the error, and nothing else in the loop makes anything. The heap is full before the list ends.
// Plain Bun has no heap limit, so the program says only that it goes on.
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

function run(holders: Holder[], wrong: object): number {
  let caught = 0;
  for (let index = 0; index < holders.length; index++) {
    const holder = holders[index];
    let thrown: any = null;
    try {
      caught += Box.read(wrong);
    } catch (error) {
      thrown = error;
    }
    holder.error = thrown;
  }
  return caught;
}

const holders: Holder[] = [];
for (let index = 0; index < 600_000; index++) holders.push(new Holder());
try {
  run(holders, {});
} catch {}
let kept = 0;
for (const holder of holders) if (holder.error instanceof TypeError) kept++;
holders.length = 0;
console.log("goes on", kept > 1000);
