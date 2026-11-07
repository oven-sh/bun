// `sort` with a comparator writes the sorted elements back into the array. A marking thread may hold the lock of the array's cell at that moment.
// The shell of the engine's tests has lockCell() and unlockCell(), which take and release that lock. Anywhere else the arrays are sorted with the lock free.
declare const console: { log(...values: unknown[]): void };
declare function lockCell(cell: object): void;
declare function unlockCell(cell: object): void;

function lock(cell: object): void {
  try {
    lockCell(cell);
  } catch {}
}

function unlock(cell: object): void {
  try {
    unlockCell(cell);
  } catch {}
}

function fill<T>(count: number, make: (seed: number) => T): T[] {
  const list: T[] = [];
  for (let k = 0; k < count; k++) list.push(make((k * 7919) % 1000));
  return list;
}

function sortUp(list: number[]): number[] {
  return list.sort((a, b) => a - b);
}

function sortDown(list: number[]): number[] {
  return list.sort((a, b) => b - a);
}

function sortTexts(list: string[]): string[] {
  return list.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function sortLocked<T>(list: T[], sort: (list: T[]) => T[]): string {
  lock(list);
  const sorted = sort(list);
  unlock(list);
  return (sorted === list) + " " + list.length + " " + list.join(" ");
}

for (const count of [2, 7, 8, 9, 40, 300]) {
  console.log("doubles up", sortLocked(fill(count, seed => seed + 0.5), sortUp));
  console.log("doubles down", sortLocked(fill(count, seed => seed + 0.5), sortDown));
  console.log("integers up", sortLocked(fill(count, seed => seed), sortUp));
  console.log("strings up", sortLocked(fill(count, seed => "s" + seed), sortTexts));
}

// The lock is taken in the middle of the sort, so the stores of the write-back are the first that find it held.
function sortAndLockAtCall(list: number[], call: number): number[] {
  let calls = 0;
  return list.sort((a, b) => {
    if (++calls === call) lock(list);
    return a - b;
  });
}
const lockedLate = fill(50, seed => seed + 0.25);
sortAndLockAtCall(lockedLate, 20);
unlock(lockedLate);
console.log("locked by the comparator", lockedLate.join(" "));

// The array takes stores the fast way again once the lock is free.
console.log("down again", sortLocked(lockedLate, sortDown));
console.log("with the lock free", sortUp(lockedLate).join(" "));
