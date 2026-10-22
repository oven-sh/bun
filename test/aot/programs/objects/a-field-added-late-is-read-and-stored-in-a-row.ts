// A field that is added late is read and stored several times in a row and in loops. Between two of these the slot may be stored into through another name for the object,
// get undefined, be emptied by delete, be taken over by an accessor or by a value of another type, or the object may be frozen: every read sees what plain JavaScript sees.
const outside: any = (globalThis as any)[process.argv[2] ?? "Array"];
type Bag = { id: number; n?: number };

function addTwice(b: Bag, x: number, y: number) {
  b.n! += x;
  b.n! += y;
  return b.n;
}
function storeTwice(b: Bag, x: number, y: number) {
  b.n = x;
  b.n = y;
  return b.n;
}
function undefinedBetween(b: Bag, x: number) {
  const before = b.n;
  b.n = undefined;
  const between = b.n;
  b.n = x;
  return [before, between, b.n, "n" in b];
}
function deletedBetween(b: Bag, x: number) {
  b.n = x;
  const before = b.n;
  delete b.n;
  return [before, b.n, "n" in b];
}
function storedThroughOtherName(a: Bag, b: Bag, x: number) {
  const before = a.n;
  b.n = x;
  return [before, a.n];
}
function undefinedThroughOtherName(a: Bag, b: Bag) {
  const before = a.n;
  b.n = undefined;
  return [before, a.n, a.n === undefined, "n" in a];
}
function otherTypeThroughOtherName(a: Bag, b: any) {
  const before = a.n;
  b.n = "text";
  return [before, a.n, typeof a.n];
}
function accessorBetween(a: Bag, b: any) {
  const before = a.n;
  Object.defineProperty(b, "n", { get: () => 42, set() {}, configurable: true });
  return [before, a.n];
}
function frozenBetween(a: Bag, b: any) {
  a.n = 1;
  Object.freeze(b);
  let threw = false;
  try {
    a.n = 2;
  } catch {
    threw = true;
  }
  return [a.n, threw];
}
function addsInLoop(b: Bag, k: number) {
  for (let i = 0; i < k; i++) b.n! += i;
  return b.n;
}
function emptiesInLoop(b: Bag, k: number) {
  let s = 0;
  for (let i = 0; i < k; i++) {
    s += b.n ?? -1;
    if (i % 3 === 2) delete b.n;
    else b.n = i;
  }
  return s;
}
function undefinedInLoop(b: Bag, k: number) {
  let s = 0;
  for (let i = 0; i < k; i++) {
    b.n = i & 1 ? undefined : i;
    s += b.n ?? -1;
  }
  return s;
}
function firstStoreAdds(b: Bag, x: number) {
  const had = "n" in b;
  b.n = x;
  const has = "n" in b;
  b.n = x + 1;
  return [had, has, b.n, Object.keys(b).join()];
}

function make(n?: number): Bag {
  const b: Bag = { id: 1 };
  outside(b);
  if (n !== undefined) b.n = n;
  return b;
}

const lines: string[] = [];
for (let turn = 0; turn < 300; turn++) {
  const shared = make(turn);
  const row: unknown[] = [
    addTwice(make(turn), 1, 2),
    storeTwice(make(turn), 1, 2),
    storeTwice(make(), 1, 2),
    undefinedBetween(make(turn), 5),
    deletedBetween(make(turn), 5),
    storedThroughOtherName(shared, shared, turn + 1),
    storedThroughOtherName(make(turn), make(turn), turn + 1),
    undefinedThroughOtherName(shared, shared),
    undefinedThroughOtherName(make(turn), make(turn)),
    addsInLoop(make(turn), 5),
    emptiesInLoop(make(turn), 8),
    undefinedInLoop(make(turn), 8),
    firstStoreAdds(make(), turn),
    firstStoreAdds(make(turn), turn),
  ];
  if (turn % 50 === 49) {
    const odd = make(turn);
    row.push(otherTypeThroughOtherName(odd, odd), addTwice(odd, 1, 2));
    const taken = make(turn);
    row.push(accessorBetween(taken, taken), addTwice(taken, 1, 2));
    const frozen = make(turn);
    row.push(frozenBetween(frozen, frozen));
  }
  if (turn < 2 || turn % 50 === 49) lines.push(JSON.stringify(row));
}
console.log(lines.join("\n"));
