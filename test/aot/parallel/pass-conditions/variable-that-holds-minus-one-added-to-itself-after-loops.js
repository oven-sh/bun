// `n2 + n2` where n2 still holds -1, behind the loops of reduce() and map(). A closure writes n2, so it is read from memory until the store of -1 is forwarded.
function f0(x, l0, o0) {
  let n0 = x, n1 = 0, n2 = -1, n3 = -1, l1 = l0;
  const bump = (v) => { n2 = (n2 + v) | 0; };
  n3 = l0.reduce((p, v) => Math.max(p, v), n1);
  n0 += n3;
  l1 = l1.map((v) => v + n0);
  n2 = (Math.imul(n2, 31) + (Math.imul(l1[0], n3) ^ (n2 + n2))) | 0;
  if (o0.a > 99) {
    for (let i = 0; i < 8; i++) n1 = l1.map((v) => { bump(1); return v; }).filter((v) => v < n2).length;
  }
  return [n0, n1, n2, n3].join();
}
console.log(f0(3, [0.5, 1.5], { a: 0.5 }), f0(0, [], { a: 0 }));
