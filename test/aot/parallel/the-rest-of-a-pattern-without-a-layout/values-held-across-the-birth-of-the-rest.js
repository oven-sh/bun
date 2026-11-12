function make(i) { const o = { deep: i }; return { id: i, o, f: () => o, d: i ? i / 2 : -0, u: undefined, b: 10n, t: "s" + i }; }
function omit(row) { const { id, u, ...rest } = row; return rest; }
const n = JSON.parse("4"), kept = []; for (let i = 0; i < n; i++) kept.push(omit(make(i)));
console.log("SAID " + kept.map(r => [Object.keys(r).join(""), r.f() === r.o, r.o.deep, Object.is(r.d, -0), r.d, r.b, r.t].join("/")).join(" "));
