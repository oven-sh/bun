// STATISTIC: RelationsFailedByHoles >= 1
// A hole fails the relation that ends the block, in an arm for lists of numbers: the sum that the arm has built in front is read on both sides of the relation. The build stopped.
class Rec { constructor(i) { this.p = [i / 3 + 0.5, i + 0.25, i]; this.v = [i, i / 3 + 0.5, i]; this.m = i; } }
function run0(list) { for (let i = 0; i < list.length; i++) { list[i].v = [list[i].p[1] + list[i].v[0] * 0.5, list[i].p[0]]; list[i].p[1] = list[i].v[1] - list[i].v[1]; } }
function run1(list) { let s = 0; for (let i = 1; i < list.length; i++) { const a = list[i], b = list[i - 1], bp = b.p; a.m = s; s += bp[1] + a.v[0] * 0.5; if (a.v[0] <= bp[1] && b.v[0] >= a.p[0] && b.p[0] <= b.p[0]) { s += a.v[0] + b.v[0] * 0.5; } else { s -= b.v[0] - a.p[0]; } if (b.v[0] < b.p[0]) s++; } return s; }
const list = []; for (let i = 0; i < 14; i++) list.push(new Rec(i));
run0(list); for (let t = 0; t < 4; t++) console.log(run1(list));
