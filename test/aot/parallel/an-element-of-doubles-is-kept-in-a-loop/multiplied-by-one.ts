// Under: --aot-harden=proof-checks: an element that is multiplied by one, divided by one or has zero taken off it is stored and read again in the same iteration
class Grid { g: any; constructor(g: any) { this.g = g; } go(w: number) { const g = this.g; let i = 1; for (let y = 0; y < g.length; y++) { const row = g[y]!; for (let x = 0; x < row.length && x < 9; x++) { g[y]![x] *= i; g[y]![x] += x / 2; g[y]![w - 1 - x] = -x; } } return g; } }
console.log(JSON.stringify(new Grid([[1, 2, 3], [4, 5.5, 6]]).go(0)), JSON.stringify(new Grid([[1, , 3], [, 2, 3]]).go(1)));

function product(list: number[], kept: any[]) { let s = 0; for (let i = 0; i < list.length; i++) { list[i] *= 1; s += list[i]; kept.push(list[i]); } return s; }
function quotient(list: number[], kept: any[]) { let s = 0; for (let i = 0; i < list.length; i++) { list[i] /= 1; s += list[i]; kept.push(list[i]); } return s; }
function difference(list: number[], kept: any[]) { let s = 0; for (let i = 0; i < list.length; i++) { list[i] -= 0; s += list[i]; kept.push(list[i]); } return s; }
function unary(list: number[], kept: any[]) { let s = 0; for (let i = 0; i < list.length; i++) { list[i] = +list[i]; s += list[i]; kept.push(list[i]); } return s; }
function elsewhere(list: number[], kept: any[]) { let s = 0; const other = list.slice(); for (let i = 0; i < list.length; i++) { other[i] = list[i] * 1; s += other[i]; kept.push(list[i], other[i]); } return s; }
const show = (v: any) => (Object.is(v, -0) ? "-0" : String(v));
for (const run of [product, quotient, difference, unary, elsewhere]) {
  for (const make of [() => [1, 2, 3], () => [0.5, 1.5, -0], () => [1, , 3], () => [0.5, , NaN], () => [, , 2.5], () => [undefined, 1, "4"] as any, () => Object.freeze([1.5, 2.5]) as any]) {
    for (let again = 0; again < 2; again++) {
      const list: any = make(), kept: any[] = [];
      let answer: any;
      try { answer = show(run(list, kept)); } catch (error: any) { answer = error.constructor.name; }
      console.log(run.name, answer, Object.keys(list).join(), kept.map(show).join());
    }
  }
}
