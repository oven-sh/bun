// STATISTIC: LoopReloadBlocksEmitted >= 1
// STATISTIC: ReloadingBackEdgesEmitted >= 1
const outside: any = JSON.parse("{}");
class Box { constructor(public list: number[], public scale: number, public limit: number) {} }
const unseen = (x: any) => { outside.kept = x; return outside.kept; };
function sum(box: any, keys: number[], grow: (at: number) => void): string {
  let total: any = 0;
  for (let i = 0; i < keys.length; i++) {
    const worth = box.scale;
    if (keys[i] === 7) { grow(i); continue; }
    total = total + worth + keys[i];
  }
  return String(total);
}
const box: any = new Box([1], 2, 0);
const grow = unseen((at: number) => { box.scale = 5; });
console.log(sum(box, [1, 2, 7, 3], grow));
box.scale = "s";
console.log(sum(box, [1, 2, 7, 3], grow), sum(box, [1], grow));
box.scale = undefined;
console.log(sum(box, [1, 7, 1], grow));
