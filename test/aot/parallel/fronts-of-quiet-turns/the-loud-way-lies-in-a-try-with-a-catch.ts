// STATISTIC: LoopReloadBlocksEmitted >= 1
// STATISTIC: ReloadingBackEdgesEmitted >= 1
class Box { constructor(public list: number[], public scale: number, public limit: number) {} }
const unseen = (x: any) => { (globalThis as any).kept = x; return (globalThis as any).kept; };
function sum(box: Box, keys: number[], grow: (at: number) => void): number {
  let total = 0;
  for (let i = 0; i < keys.length; i++) {
    const worth = box.scale;
    if (keys[i] === 7) { try { grow(i); } catch (error) { total += 1000; } continue; }
    total += worth + keys[i];
  }
  return total;
}
const box = new Box([1], 2, 0);
const grow = unseen((at: number) => { box.scale = 3 + at; if (at === 4) throw new Error("four"); });
console.log(sum(box, [1, 2, 7, 3, 7, 4], grow), sum(box, [5, 7, 5], grow), sum(box, [0, 0, 0, 0, 7, 1], grow));
