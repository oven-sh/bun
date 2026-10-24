// `[f = one] = [7]` stores 7, so calling f throws a TypeError.
function t(n) {
  const one = () => n;
  let f = one;
  [f = one] = [7];
  return () => f();
}
try { console.log(t(1)()); } catch (e) { console.log(e.name); }
