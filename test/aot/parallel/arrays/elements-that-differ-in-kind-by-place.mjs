// A matrix that a literal makes, [0.5, 1.5, 2.5, 0, ..], beside a list that nobody knows: what is loaded at once off the matrix was typed by the read that came first, though only that element is an integer.
const N = 8, show = a => Array.from(a, v => Object.is(v, -0) ? "-0" : String(v)).join(" ");
const ms = Array.from({ length: N }, (_, i) => [i + 0.5, i - 0.25, i * 1.5 + 0.125, 0, 2.5, 3.5, i / 3, 1]);
const us = JSON.parse("[[0.5,1.5,2.5,3],[1,2.25,3,4],[0.25,1,1,1],[7,8,9,0.5],[1,1,1,1],[2,2.5,2,2],[3,3,3,3.75],[4,4,4,4]]");
function dot(a, b) { return a[3] * b[3] + a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { const t = a[0] * b[3] - b[7] * a[1]; return t + a[2] * b[0] - a[3] * b[1] - b[2] * a[0] * b[6]; }
class M { constructor(e) { this.e = e; } apply(v) { const e = this.e; return v[0] * e[3] + v[1] * e[7] + v[2] * e[0] + v[3] * e[1] - e[2] * v[0]; } }
const os = ms.map(e => new M(e));
const forms = {
  dots() { let s = 0; for (let i = 1; i < N; i++) s += dot(us[i], ms[i - 1]) - dot(ms[i], us[i - 1]); return String(s); },
  crosses() { let s = 0; for (let i = 1; i < N; i++) s += cross(us[i], ms[i - 1]); return String(s); },
  methods() { let s = 0; for (let i = 0; i < N; i++) s += os[i].apply(us[i]); return String(s); },
  once() { return dot(us[3], ms[2]) + " " + cross(us[2], ms[5]) + " " + os[1].apply(us[4]); },
};
for (let q = 0; q < 30; q++) for (const f of Object.keys(forms)) forms[f]();
for (const f of Object.keys(forms)) console.log(f, forms[f]());
