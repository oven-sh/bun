// A var of a parameter's name in a function whose parameters have expressions is a variable of its own. All of its declarations store into it, not the first alone.
const hide = x => JSON.parse(JSON.stringify(x));
const t = {
  a(k = 0) { var k = hide(5); return k; },
  b(k = 0) { var k; return k; },
  c(k = 0) { var k; k = hide(7); return k; },
  d(k = 0) { var k; var k = hide(7); return k; },
  e(k = 0) { var k = hide(1); var k; return k; },
  f(k = 0) { var k; var k; return k; },
  g(k = 0) { for (var k of hide([1, 2])); return k; },
  h(k = 0, f = () => k) { var k; var k = hide(2); return [k, f()]; },
  i(k = 0, f = () => k) { var k; return [k, f(), (k = hide(3)), k, f()]; },
  j(k = 0) { var k = hide(1); var k = hide(2); return k; },
  l(k) { var k; var k = hide(7); return k; },
  m([k] = [0]) { var k; var k = hide(7); return k; },
  n(k = 0) { var k; { var k = hide(8); } return k; },
  o(k = 0) { var k; if (hide(1)) var k = hide(9); return k; },
  p(k = 0) { var k; return (() => { k = hide(4); return k; })() + k; },
  q(k = 0) { var k; var k = hide(7); return () => k; },
  r(k = 0) { var k; switch (1) { case 1: var k = hide(6); } return k; },
  s(k = 0) { var k; try { throw hide(1); } catch (e) { var k = e; } return k; },
  u(k = 0) { var k; k++; return k; },
  v(k = hide(0)) { var k; var [k] = hide([3]); return k; },
  w(k = 0) { var k, k = hide(5), k; return k; },
};
for (const n in t) { let a = t[n](), b = t[n]([4]); if (typeof a === "function") a = a(); if (typeof b === "function") b = b(); console.log(n, JSON.stringify(a), JSON.stringify(b)); }
function top(k = 0) { var k; var k = hide(7); return k; }
console.log(top(), top(3));
const list = [3, 1, 2], key = hide("toSorted");
function method(k = 0) { var k; var k = key; return list[k]; }
console.log(typeof method(), method().call(list).join());
