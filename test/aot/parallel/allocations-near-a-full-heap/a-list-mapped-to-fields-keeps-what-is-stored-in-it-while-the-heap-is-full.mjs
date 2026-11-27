// A list that map() makes where the heap has no room is marked by the collection at the poll behind its allocation. What is stored in it afterwards must outlive the next eden collection.
// Env: BUN_JSC_markedBlockCageSizeInMB=64
// STATISTIC: ArrayCallbacksRunByStubs >= 2
import { edenGC, releaseWeakRefs } from "bun:jsc";

const rows = JSON.parse(
  JSON.stringify(Array.from({ length: 120 }, (_, i) => ({ name: "outer " + i, inner: { name: "inner " + i } }))),
);

// The functions are too large to be copied into the loop.
function names(list, turn) {
  if (turn < -1) {
    console.log("never 0", turn * 2, turn - 0, turn % 3);
    console.log("never 1", turn * 3, turn - 1, turn % 4);
    console.log("never 2", turn * 4, turn - 2, turn % 5);
    console.log("never 3", turn * 5, turn - 3, turn % 6);
    console.log("never 4", turn * 6, turn - 4, turn % 7);
    console.log("never 5", turn * 7, turn - 5, turn % 8);
    console.log("never 6", turn * 8, turn - 6, turn % 9);
    console.log("never 7", turn * 9, turn - 7, turn % 10);
    console.log("never 8", turn * 10, turn - 8, turn % 11);
    console.log("never 9", turn * 11, turn - 9, turn % 12);
    console.log("never 10", turn * 12, turn - 10, turn % 13);
    console.log("never 11", turn * 13, turn - 11, turn % 14);
  }
  return list.map(row => row.name);
}
function innerNames(list, turn) {
  if (turn < -1) {
    console.log("never 0", turn * 2, turn - 0, turn % 3);
    console.log("never 1", turn * 3, turn - 1, turn % 4);
    console.log("never 2", turn * 4, turn - 2, turn % 5);
    console.log("never 3", turn * 5, turn - 3, turn % 6);
    console.log("never 4", turn * 6, turn - 4, turn % 7);
    console.log("never 5", turn * 7, turn - 5, turn % 8);
    console.log("never 6", turn * 8, turn - 6, turn % 9);
    console.log("never 7", turn * 9, turn - 7, turn % 10);
    console.log("never 8", turn * 10, turn - 8, turn % 11);
    console.log("never 9", turn * 11, turn - 9, turn % 12);
    console.log("never 10", turn * 12, turn - 10, turn % 13);
    console.log("never 11", turn * 13, turn - 11, turn % 14);
  }
  return list.map(row => row.inner.name);
}

const kept = [];
const lists = new Array(16).fill(null);
const stored = new Array(16).fill(null);

function untilFull(run) {
  try {
    run();
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }
  kept.length -= 2000;
}

// One list in four stays, so each collection finds less room than the one before it: behind the fourth that finds next to none the poll collects, behind the fifth it throws.
// `bun <file>` has room for all of them.
function countLost(readsInner) {
  let lost = 0;
  untilFull(() => {
    for (let turn = 0; turn < 12_000; turn++) {
      const made = readsInner ? innerNames(rows, turn) : names(rows, turn);
      made[0] = { turn };
      lists[turn % lists.length] = made;
      stored[turn % lists.length] = new WeakRef(made[0]);
      if (turn % 4 === 0) kept.push(made);
      if (turn % lists.length !== lists.length - 1) continue;
      releaseWeakRefs();
      edenGC();
      for (let i = 0; i < lists.length; i++) {
        if (stored[i].deref() !== undefined) continue;
        lost++;
        lists[i][0] = null;
      }
    }
  });
  return lost;
}

untilFull(() => {
  for (let turn = 0; turn < 80_000; turn++) kept.push(names(rows, turn));
});
console.log("names", countLost(false));
console.log("inner names", countLost(true));
