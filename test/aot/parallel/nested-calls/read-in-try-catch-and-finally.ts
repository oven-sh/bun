function outer(fail: boolean) {
  const seen: unknown[] = [];
  try { seen.push(f); if (fail) throw new Error("x"); seen.push(g); } catch { seen.push(f, g); } finally { seen.push(f, g); }
  seen.push(f, g);
  return new Set(seen).size + ":" + seen.length;
  function f() { return 1; }
  function g() { return 2; }
}
function firstInCatch() {
  let a: unknown, b: unknown;
  try { throw 1; } catch { a = h; }
  b = h;
  return a === b;
  function h() {}
}
function thrownBetween() {
  let a: unknown;
  try { a = keep(h); throw 1; } catch { return a === h; }
  function h() {}
  function keep<T>(x: T) { return x; }
}
console.log(outer(false), outer(true), firstInCatch(), thrownBetween());
