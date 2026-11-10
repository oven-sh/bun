// STATISTIC: LoopReloadBlocksEmitted >= 1
// STATISTIC: ReloadingBackEdgesEmitted >= 1
class Box { constructor(public list: number[], public scale: number, public limit: number) {} }
const unseen = (x: any) => { (globalThis as any).kept = x; return (globalThis as any).kept; };
function sum(box: Box, grow: (at: number) => void): number {
  let total = 0;
  for (let i = 0; i < box.list.length; i++) {
    const worth = box.scale;
    if (box.list[i] === 7) { grow(i); continue; }
    total += box.list[i] * worth;
  }
  return total;
}
const box = new Box([1, 2, 7, 3, 4], 2, 0);
const grow = unseen((at: number) => { box.list = [9, 9, 9, 9, 5, 6, 8]; box.scale = 3; });
console.log(sum(box, grow));
box.list = [7, 1];
console.log(sum(box, grow));
