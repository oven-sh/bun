function relate(a: number, b: number, c: number, d: number, e: number, f: number, g: number) {
  let depth = 0, most = 0;
  const h = a + b, i = c + d, j = e + f;
  return one(3) + ":" + most;
  function one(n: number): number { enter(); const r = n > 0 ? two(n - 1) + a + h : g; leave(); return r; }
  function two(n: number): number { enter(); const r = n > 0 ? three(n - 1) + b + c + i : d; leave(); return r; }
  function three(n: number): number { enter(); const r = n > 0 ? one(n - 1) + e + f + j : g; leave(); return r; }
  function enter() { depth++; if (depth > most) most = depth; }
  function leave() { depth--; }
}
console.log(relate(1, 2, 3, 4, 5, 6, 7), relate(7, 6, 5, 4, 3, 2, 1));
