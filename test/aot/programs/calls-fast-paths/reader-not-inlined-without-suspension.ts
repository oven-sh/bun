// A function that only reads the object literal it is handed is inlined into a caller that suspends, so that the literal need not stay alive across the suspension. In a caller that never suspends the copy would only cost bytes: the call stays a call.
// IR= 1 plain CallDirect
// IR= 0 suspends : =?L[0-9]+ = NewObject 
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
function plain(n: number): number {
  return measure({ width: n, height: n + 1, depth: n + 2, name: "box" });
}
async function suspends(n: number): Promise<number> {
  const box: Box = { width: n, height: n + 1, depth: n + 2, name: "box" };
  const before = measure(box);
  await undefined;
  return before + box.depth;
}
console.log(plain(3), await suspends(3));
