// A TypeError quotes the read, the store or the call that failed, also where its line has another of the same name: `this.x + o.x`.
// The functions are handed on as values, so the executable holds their text.
const thrown = run => {
  try {
    run();
    return "nothing thrown";
  } catch (error) {
    return String(error);
  }
};
const one = { x: 1, y: 2, a: { x: 1 }, p: { x: 1 }, run: () => 1 };

export class V {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  add(o) { return this.x + o.x; }
  turned(o) { return o.x + this.x; }
  both(o) { return new V(this.x + o.x, this.y + o.y); }
  deep(o) { return this.a.x + o.a.x; }
  store(o) { this.x = o.x; }
  call(o) { return this.run() + o.run(); }
  overLines(o) {
    return this.x +
      o.x;
  }
  static sum(a, b) { return a.x + b.x; }
}
export function strict(o) { "use strict"; return this.x + o.x; }
export function parameters(a, b) { return a.x + b.x; }
export function three(a, b, c) { return a.x * b.x - c.x; }
export function paths(a, b) { return a.p.x + b.p.x; }
export function elements(a, b) { return a[0].x + b[0].x; }
export function keys(a, b, k) { return a[k] + b[k]; }
export function results(a, b) { return a().x + b().x; }
export function stores(a, b) { a.x = 1; b.x = 2; }
export function behindOtherLetters(a, b) { return "é𝒳 ü" + a.x + "𝒳" + b.x; }
export function behindTextOverLines(a, b) { return `
  ` + a.x + b.x; }
export const sameText = [(a, b) => a.x + b.x,
  (a, b) => a.x + b.x];
export function calls(a, b) { return a.run(1) + b.run(2); }
export function iterations(a, b) { for (const x of a) for (const y of b) return x + y; }
export function spreads(a, b) { return [...a, ...b]; }
export function keyTests(a, b) { return ("x" in a) + ("x" in b); }
export function deletions(a, b) { delete a.x; delete b.x; }
export function constructions(A, B) { return [new A(1), new B(2)]; }
export function patterns(a, b) { const { x } = a, { x: y } = b; return x + y; }
export const small = (a, b) => a.x + b.x;
export function callsSmall(a, b) { return small(a, b) + small(b, a); }

const { add, turned, both, deep, store, call, overLines } = V.prototype;
for (let round = 0; round < 2; round++) {
  console.log(thrown(() => add(one)));
  console.log(thrown(() => add.call(null, one)));
  console.log(thrown(() => new V(1, 2).add(undefined)));
  console.log(thrown(() => turned(one)));
  console.log(thrown(() => new V(1, 2).turned(null)));
  console.log(thrown(() => both(one)));
  console.log(thrown(() => new V(1, 2).both(null)));
  console.log(thrown(() => deep(one)));
  console.log(thrown(() => deep.call({}, one)));
  console.log(thrown(() => deep.call(one, {})));
  console.log(thrown(() => store(one)));
  console.log(thrown(() => store.call({}, undefined)));
  console.log(thrown(() => call(one)));
  console.log(thrown(() => call.call(one, undefined)));
  console.log(thrown(() => overLines(one)));
  console.log(thrown(() => new V(1, 2).overLines(undefined)));
  console.log(thrown(() => V.sum(null, one)));
  console.log(thrown(() => V.sum(one, null)));
  console.log(thrown(() => strict(one)));
  console.log(thrown(() => strict.call(one, undefined)));
  console.log(thrown(() => parameters(undefined, one)));
  console.log(thrown(() => parameters(one, null)));
  console.log(thrown(() => three(undefined, one, one)));
  console.log(thrown(() => three(one, undefined, one)));
  console.log(thrown(() => three(one, one, undefined)));
  console.log(thrown(() => paths({}, one)));
  console.log(thrown(() => paths(one, {})));
  console.log(thrown(() => paths(one, undefined)));
  console.log(thrown(() => elements([null], [one])));
  console.log(thrown(() => elements([one], [null])));
  console.log(thrown(() => keys(undefined, one, "x")));
  console.log(thrown(() => keys(one, undefined, "x")));
  console.log(thrown(() => results(() => undefined, () => one)));
  console.log(thrown(() => results(() => one, () => undefined)));
  console.log(thrown(() => stores(null, {})));
  console.log(thrown(() => stores({}, null)));
  console.log(thrown(() => behindOtherLetters(undefined, one)));
  console.log(thrown(() => behindOtherLetters(one, undefined)));
  console.log(thrown(() => behindTextOverLines(undefined, one)));
  console.log(thrown(() => behindTextOverLines(one, undefined)));
  console.log(thrown(() => calls(undefined, one)));
  console.log(thrown(() => calls(one, undefined)));
  console.log(thrown(() => calls({}, one)));
  console.log(thrown(() => calls(one, {})));
  console.log(thrown(() => iterations(undefined, [1])));
  console.log(thrown(() => iterations([1], undefined)));
  console.log(thrown(() => spreads(undefined, [1])));
  console.log(thrown(() => spreads([1], undefined)));
  console.log(thrown(() => keyTests(1, {})));
  console.log(thrown(() => keyTests({}, 1)));
  console.log(thrown(() => deletions(null, {})));
  console.log(thrown(() => deletions({}, null)));
  console.log(thrown(() => constructions(1, Object)));
  console.log(thrown(() => constructions(Object, 1)));
  console.log(thrown(() => patterns(null, {})));
  console.log(thrown(() => patterns({}, null)));
  for (const sum of sameText) {
    console.log(thrown(() => sum(undefined, one)));
    console.log(thrown(() => sum(one, undefined)));
  }
  console.log(thrown(() => callsSmall(undefined, one)));
  console.log(thrown(() => callsSmall(one, undefined)));
}
