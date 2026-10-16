export function addUntyped(a, b) {
  return a + b;
}
export function makeUntypedClosure(k) {
  return x => x + k;
}
export function makePlainBox(w, h) {
  return { w, h };
}
export class PlainCounter {
  n = 0;
  bump(by) {
    this.n += by;
    return this.n;
  }
}
export function callsFromUntyped(made, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s += made(i);
  return s;
}
