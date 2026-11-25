// A version of a loop asks the fields of a constant of the file for their integers in its preheader, and a number behind a mask is a position.
// STATISTIC: IntegerSlotGuardsHoisted >= 1
class Ring {
  private readonly a = new Array<number>(16).fill(0); h = 0; size = 0;
  push(v: number): void { this.a[(this.h + this.size++) & 15] = v; }
  shift(): number { const v = this.a[this.h]!; this.h = (this.h + 1) & 15; this.size--; return v; }
}
const ring = new Ring(), cursor = { at: 0, list: [1, 2, 3, 4, 5, 6, 7, 8] };
function run(turns: number): number { let n = 0; for (let k = 0; k < turns; k++) { ring.push(k & 7); if (ring.size > 8) n += ring.shift(); } return n; }
function given(q: Ring, turns: number): number { let n = 0; for (let k = 0; k < turns; k++) { q.push(k & 7); if (q.size > 8) n += q.shift(); } return n; }
function pushes(turns: number): number { for (let k = 0; k < turns; k++) { ring.push(k); ring.push(k + 1); } return ring.size; }
function steps(turns: number): number { let n = 0; for (let k = 0; k < turns; k++) n += cursor.list[cursor.at++ & 7]!; return n; }
console.log(run(100), ring.size, ring.h, run(3), ring.size);
const other = new Ring(); console.log(given(other, 60), other.size, other.h);
ring.size = 0.5; console.log(run(20), ring.size, ring.h);
ring.size = 2147483640; console.log(pushes(8), ring.size, run(9), ring.size);
ring.size = 2 ** 53 - 4; console.log(pushes(6), ring.size, pushes(3), ring.size);
ring.size = NaN; console.log(run(5), ring.size, pushes(2)); ring.size = -3; console.log(run(30), ring.size, ring.h);
console.log(steps(20), cursor.at); cursor.at = 4294967290; console.log(steps(20), cursor.at); cursor.at = 2 ** 53; console.log(steps(4), cursor.at); cursor.at = -2.5; console.log(steps(5), cursor.at);
