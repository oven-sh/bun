// A list, a literal or a closure that stands in one call alone is not always dead behind that call: the callee keeps it in another object of the caller or hands it back, or the call runs many times and the cell was made once.
type Thing = { id: number };
type Box = { list: Thing[] | null; inner: { held: Thing } | null };
function fillList(box: Box, list: Thing[]): void {
  box.list = list;
}
function fillInner(box: Box, inner: { held: Thing }): void {
  box.inner = inner;
}
function same<T>(value: T): T {
  return value;
}
function attempt(callback: () => number): number {
  return callback();
}
function first(list: Thing[]): number {
  return list[0].id;
}
function heldOf(box: { held: Thing }): number {
  return box.held.id;
}
function keptInAnotherObject(n: number): number {
  const box: Box = { list: null, inner: null };
  fillList(box, [{ id: n }, { id: n + 1 }]);
  fillInner(box, { held: { id: n + 2 } });
  Bun.gc(true);
  return box.list![0].id + box.list![1].id + box.inner!.held.id;
}
function handedBack(n: number): number {
  const list = same([{ id: n }, { id: n + 2 }]);
  const literal = same({ held: { id: n + 3 } });
  Bun.gc(true);
  return list[0].id + list[1].id + literal.held.id;
}
function closureMadeOnce(n: number): number {
  const thing = { id: n };
  const callback = () => thing.id + 1;
  let total = 0;
  for (let turn = 0; turn < 3; turn++) {
    total += attempt(callback);
    Bun.gc(true);
  }
  return total;
}
function listMadeOnce(n: number): number {
  const list = [{ id: n }];
  let total = 0;
  for (let turn = 0; turn < 3; turn++) {
    total += first(list);
    Bun.gc(true);
  }
  return total;
}
function literalMadeOnce(n: number): number {
  const literal = { held: { id: n } };
  let total = 0;
  for (let turn = 0; turn < 3; turn++) {
    total += heldOf(literal);
    Bun.gc(true);
  }
  return total;
}
const sums: number[] = [];
for (let turn = 0; turn < 3; turn++) sums.push(keptInAnotherObject(turn), handedBack(turn), closureMadeOnce(turn), listMadeOnce(turn), literalMadeOnce(turn));
console.log(sums.join(" "));
