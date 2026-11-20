// STATISTIC: LoopReloadBlocksEmitted >= 1
// STATISTIC: ReloadingBackEdgesEmitted >= 1
const outside: any = JSON.parse("{}");
class Box { constructor(public list: number[], public scale: number, public limit: number) {} }
const unseen = (x: any) => { outside.kept = x; return outside.kept; };
function sum(box: Box, keys: number[], grow: (at: number) => void): number {
  let total = 0;
  turns: for (let i = 0; i < keys.length; i++) {
    const worth = box.scale;
    check: {
      if (keys[i] !== 7) break check;
      grow(i);
      continue turns;
    }
    total += worth + keys[i];
  }
  return total;
}
const box = new Box([1], 2, 0);
const grow = unseen((at: number) => { box.scale = 3 + at; });
console.log(sum(box, [1, 2, 7, 3, 7, 4], grow), sum(box, [5, 7, 5], grow));
