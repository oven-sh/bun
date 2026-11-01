// What a generator writes behind a yield is written when somebody steps it: whoever reads the same place after the steps finds it changed.
function* f(n) {
  yield "a";
  if (!(n > 0)) return;
  f = g;
  yield* f(n - 1);
}
function g(n) {
  return ["b" + n];
}
console.log([...f(1)].join());
console.log([...f(1)].join());
// A variable of the module, a field of an object of the module, an element, a Map, a captured variable.
let count = 0;
const state = { total: 0, list: [1, 2, 3], seen: new Map() };
function* writes(n) {
  yield 0;
  count += n;
  yield 1;
  state.total += n;
  state.list[0] = n;
  yield 2;
  state.list.length = 1;
  state.seen.set(n, count);
}
function readsAround(n) {
  const before = [count, state.total, state.list[0], state.list.length, state.seen.size];
  const all = [...writes(n)];
  return [before, all, [count, state.total, state.list[0], state.list.length, state.seen.size]];
}
console.log(JSON.stringify(readsAround(5)), JSON.stringify(readsAround(process.argv.length)));
function byHand(n) {
  const it = writes(n);
  const a = count; it.next();
  const b = count; it.next();
  const c = count; it.next();
  const d = state.total; it.next();
  return [a, b, c, count, d, state.total, state.list.length];
}
state.list = [7, 8, 9];
console.log(JSON.stringify(byHand(10)));
function outer() {
  let local = 0;
  function* inner() { yield local; local = 5; yield local; local = 9; }
  const it = inner();
  const r = [local, it.next().value, local, it.next().value, local, it.next().done, local];
  return r;
}
console.log(JSON.stringify(outer()));
// The step is made by a built-in, by destructuring, by a helper and by another generator.
let log = "";
function* notes() { yield 1; log += "x"; yield 2; log += "y"; }
{ const before = log; Array.from(notes()); console.log(before + "|" + log); }
{ const before = log; const [p, q] = notes(); console.log(before + "|" + log, p, q); }
{ const before = log; notes().forEach(() => {}); console.log(before + "|" + log); }
function* through() { yield* notes(); }
{ const before = log; for (const v of through()); console.log(before + "|" + log); }
// return() and throw() run the finally block, which writes.
let closed = 0;
function* closes() { try { yield 1; yield 2; } finally { closed++; } }
{ const it = closes(); it.next(); const before = closed; it.return(); console.log(before, closed); }
{ const it = closes(); it.next(); const before = closed; try { it.throw(new Error("t")); } catch {} console.log(before, closed); }
{ const before = closed; for (const v of closes()) break; console.log(before, closed); }
