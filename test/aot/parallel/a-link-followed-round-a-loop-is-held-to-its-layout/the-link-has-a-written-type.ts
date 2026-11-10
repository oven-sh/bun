// STATISTIC: LoopCarriedObjectsShapeChecked = 0
interface Tie { readonly end: Knot; next: Tie | null }
class Knot { ties: Tie | null = null; flags = 0; }
function mark(knot: Knot, bit: number): number {
  let touched = 0;
  for (let tie = knot.ties; tie !== null; tie = tie.next) {
    const end = tie.end;
    if ((end.flags & bit) !== 0) continue;
    end.flags |= bit;
    touched++;
  }
  return touched;
}
const hub = new Knot();
for (let i = 0; i < 3; i++) hub.ties = { end: new Knot(), next: hub.ties };
let all = 0;
for (let turn = 0; turn < 3000; turn++) all = (all * 3 + mark(hub, 1 << (turn % 20))) % 1000003;
console.log(all);
