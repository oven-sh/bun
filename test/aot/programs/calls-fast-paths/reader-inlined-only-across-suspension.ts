// A function that only reads the object it is handed is inlined into a caller that suspends where the caller uses the object again after the suspension: then the object is never made, and only what is read again stays alive while the caller waits. Where the object is dead by then, the copy would let go of nothing, and the call stays a call.
// IR= 1 handsLiteral : =?L[0-9]+ = NewObject 
// IR= 1 readsAgainAtOnce : =?L[0-9]+ = NewObject 
// IR= 1 madeAfterTheAwait : =?L[0-9]+ = NewObject 
// IR= 0 readsAgainLater : =?L[0-9]+ = NewObject 
interface Box {
  width: number;
  height: number;
  depth: number;
  name: string;
}
function measure(box: Box): number {
  const area = box.width * box.height;
  const volume = area * box.depth;
  const edges = 4 * (box.width + box.height + box.depth);
  return volume + 2 * area + edges + box.name.length * 3 + (area > volume ? 1 : 2);
}
async function handsLiteral(n: number): Promise<number> {
  const before = measure({ width: n, height: n + 1, depth: n + 2, name: "box" });
  await undefined;
  return before + n;
}
async function readsAgainAtOnce(n: number): Promise<number> {
  const box: Box = { width: n, height: n + 1, depth: n + 2, name: "box" };
  const before = measure(box) + box.depth;
  await undefined;
  return before;
}
async function madeAfterTheAwait(n: number): Promise<number> {
  await undefined;
  const box: Box = { width: n, height: n + 1, depth: n + 2, name: "box" };
  return measure(box) + box.depth;
}
async function readsAgainLater(n: number): Promise<number> {
  const box: Box = { width: n, height: n + 1, depth: n + 2, name: "box" };
  const before = measure(box);
  await undefined;
  return before + box.depth;
}
console.log(await handsLiteral(3), await readsAgainAtOnce(3), await madeAfterTheAwait(3), await readsAgainLater(3));
