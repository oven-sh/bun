const mk = () => function () { return 1; };
function run(m, a) {
  const h1 = mk(), h2 = mk();
  const out = [];
  for (let i = 0; i < m; i++) {
    const o = {};
    o.f = (i & 1) === a ? h1 : h2;
    out.push(o);
  }
  return out;
}
let r = [];
for (let k = 0; k < 3; k++) r = run(4, 0);
console.log(r[0].f === r[2].f, r[1].f === r[3].f, r[0].f === r[1].f, new Set(r.map((o) => o.f)).size);
