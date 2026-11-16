// STATISTIC: RelationsFailedByHoles >= 1
// The same loop over a list that was cut and grown again.
class Rec { constructor(i) { this.p = [i / 3 + 0.5, i + 0.25, i]; this.v = [i, i / 3 + 0.5, i]; this.m = i; } }
function run0(list) { for (let i = 0; i < list.length; i++) { list[i].v = [list[i].p[1] + list[i].v[0] * 0.5, list[i].p[0]]; list[i].p[1] = list[i].v[1] - list[i].v[1]; } }
function run1(list) { let s = 0; for (let i = 1; i < list.length; i++) { const a = list[i], b = list[i - 1], bp = b.p; a.m = s; s += bp[1] + a.v[0] * 0.5; if (a.v[0] <= bp[1] && b.v[0] >= a.p[0] && b.p[0] <= b.p[0]) { s += a.v[0] + b.v[0] * 0.5; } else { s -= b.v[0] - a.p[0]; } if (b.v[0] < b.p[0]) s++; } return s; }
const list = []; for (let i = 0; i < 14; i++) list.push(new Rec(i));
run0(list); for (let t = 0; t < 4; t++) console.log(run1(list)); const h = [0.5, 1.5, 3.5]; h.length = 1; h[2] = 2.5; list[4].p = h; console.log(run1(list)); list[7].p = h; console.log(run1(list), run1(list));
