// Who takes the value of a function that has not been made yet calls one stub, which makes it, stores it and tells the collector.
// CALLS+ take NewTypedClosureWithoutCaptureOnce32
// CALLS+ takeBound NewTypedClosureOnce32
// CALLS- take BarrierSlow
// CALLS- takeBound BarrierSlow
// CALLS- make NewTypedClosure
interface Kit { name: string; add: (x: number) => number; twice: (x: number) => number; word?: () => string; }
const kept: Kit[] = [], panels: Panel[] = [];
function make(name: string): Kit { const kit: Kit = { name, add: x => x + 1, twice: x => x * 2, word: () => "w" }; kept.push(kit); return kit; }
function take(kit: Kit, which: number): Function { return which === 0 ? kit.add : which === 1 ? kit.twice : kit.word!; }
class Panel { n: number; grow = (x: number) => x + this.n; shrink = (x: number) => x - this.n; constructor(n: number) { this.n = n; } }
function takeBound(panel: Panel, which: number): Function { return which ? panel.shrink : panel.grow; }
for (let i = 0; i < 64; i++) { make("k" + i); panels.push(new Panel(i)); }
let garbage: unknown[] = [];
for (let round = 0; round < 200; round++) { garbage = []; for (let i = 0; i < 500; i++) garbage.push({ round, i }); }
let total = 0, same = 0;
for (let i = 0; i < 64; i++) {
  const add = take(kept[i], 0), twice = take(kept[i], 1), word = take(kept[i], 2), grow = takeBound(panels[i], 0), shrink = takeBound(panels[i], 1);
  total += add(i) + twice(i) + word().length + grow(1) + shrink(1);
  if (take(kept[i], 0) === add && take(kept[i], 1) === twice && take(kept[i], 2) === word && takeBound(panels[i], 0) === grow && takeBound(panels[i], 1) === shrink) same++;
}
for (let round = 0; round < 200; round++) { garbage = []; for (let i = 0; i < 500; i++) garbage.push({ round, i }); }
for (let i = 0; i < 64; i++) total += kept[i].add(1) + take(kept[i], 1)(2) + takeBound(panels[i], 0)(0);
console.log(total, same, garbage.length, [make, take, takeBound].map(taker => taker.name).join());
