// STATISTIC: LoopReloadBlocksEmitted >= 1
// STATISTIC: ReloadingBackEdgesEmitted >= 1
const outside: any = JSON.parse("{}");
class Box { constructor(public list: number[], public scale: number, public limit: number) {} }
const unseen = (x: any) => { outside.kept = x; return outside.kept; };
class Purse { constructor(public coins: number, public rate: number) {} worth(): number { return this.coins * this.rate; } raise(): void { this.rate = this.rate + 1; } }
function sum(purse: Purse, keys: number[], grow: (at: number) => void): number {
  let total = 0;
  for (let i = 0; i < keys.length; i++) {
    const worth = purse.worth();
    if (keys[i] === 7) { grow(i); continue; }
    total += worth + keys[i];
    if (keys[i] === 2) purse.raise();
  }
  return total;
}
const purse = new Purse(1, 2);
const grow = unseen((at: number) => { purse.coins = at + 10; purse.rate = 3; });
console.log(sum(purse, [1, 2, 3, 7, 4, 2, 5], grow), sum(purse, [5, 7, 5], grow));
