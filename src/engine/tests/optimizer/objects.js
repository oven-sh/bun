const shapes = () => [[{ x: 1 }], [{ y: 0, x: 2 }], [Object.create({ x: 3 })], [{ get x() { return 4; } }], [{}], ["s"], [5], [null], [new Proxy({}, { get: () => 6 })]];
check(o => o.x, shapes);
check(o => { o.x = 9; return o.x; }, shapes);
check(o => { const before = o.x; Object.defineProperty(o, "x", { value: 8 }); return [before, o.x]; }, shapes);
check(n => { const o = {}; o.a = o.b = o.c = o.d = o.e = o.f = o.g = o.h = o.i = n; return o; }, () => [[1], ["x"], [{}]]);
check(n => { function P(v) { this.v = v; this.w = [v]; } const all = []; for (let i = 0; i < 40; i++) all[i] = new P(n + i); return all[39].w[0] + all[0].v; }, () => [[1], [0.5], ["x"]]);
const arrays = () => [[[1, 2, 3]], [[1.5, 2.5]], [["a", {}]], [[1, , 3]], [[]], ["abc"], [new Int8Array(3)], [Object.freeze([1, 2])], [{ 1: 5, length: 2 }]];
for (const index of ["1", "-1", "5", "1.5", "-0", '"1"']) {
  check(`a => [a[${index}], a.length]`, arrays);
  for (const value of ["4", "4.5", "NaN", '"v"']) check(`a => { a[${index}] = ${value}; return [a, a.length]; }`, arrays);
}
check(n => { let count = n; const up = () => ++count; up(); up(); return count; }, singles);
check((i, v) => { const a = (globalThis.kept = [{}, {}]); a[i] = v; return [a[0], a.length]; }, () => [[2, 1], [3, {}], [1e8, {}], [-1, 1]]);
{
  const a = [{}, {}];
  a.tag = 1;
  const store = (i, v) => { a[i] = v; return a[0]; };
  for (let i = 2; i < 80; i++) store(i, {});
  if (show(store(1e8, {})) !== "{}") throw new Error("the first element is gone");
}
globalThis.eval("var latest");
check((a, i) => { latest = a[i]; return latest === undefined; }, () => [[["", "", , ""], 1], [["", "", , ""], 2]]);
check((a, i, o) => { o.p = a[i]; return o.p === undefined; }, () => [[["", , ""], 0, { p: 1 }], [["", , ""], 1, { p: 1 }]]);
