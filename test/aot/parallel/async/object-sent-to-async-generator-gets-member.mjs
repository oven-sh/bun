// An object is sent to an async generator by next(), and the generator adds a member to it.
// Flags: --aot-validate
async function* g() {
  const o = yield 1;
  o.r = 5;
  yield 2;
}
const it = g();
await it.next();
const o = { a: 1 };
const p = it.next(o);
console.log(o.r, Object.keys(o).join());
await p;
console.log(o.r);
