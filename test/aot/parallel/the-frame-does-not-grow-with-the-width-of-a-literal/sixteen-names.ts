type Row = { f0: number; f1: number; f2: number; f3: number; f4: number; f5: number; f6: number; f7: number; f8: number; f9: number; f10: number; f11: number; f12: number; f13: number; f14: number; f15: number; next: Row | null };
function copy(n: Row, left: number): Row | null { return left === 0 ? null : { f0: n.f0 | 0, f1: n.f1 | 0, f2: n.f2 | 0, f3: n.f3 | 0, f4: n.f4 | 0, f5: n.f5 | 0, f6: n.f6 | 0, f7: n.f7 | 0, f8: n.f8 | 0, f9: n.f9 | 0, f10: n.f10 | 0, f11: n.f11 | 0, f12: n.f12 | 0, f13: n.f13 | 0, f14: n.f14 | 0, f15: n.f15 | 0, next: copy(n.next!, left - 1) }; }
const deep = 12000;
let chain: Row | null = null;
for (let i = 0; i < deep; i++) chain = { f0: i + 0, f1: i + 1, f2: i + 2, f3: i + 3, f4: i + 4, f5: i + 5, f6: i + 6, f7: i + 7, f8: i + 8, f9: i + 9, f10: i + 10, f11: i + 11, f12: i + 12, f13: i + 13, f14: i + 14, f15: i + 15, next: chain };
let count = 0, sum = 0;
for (let at = copy(chain!, deep); at; at = at.next) { count++; sum += at.f0 + at.f15; }
console.log("SAID", count, sum);
