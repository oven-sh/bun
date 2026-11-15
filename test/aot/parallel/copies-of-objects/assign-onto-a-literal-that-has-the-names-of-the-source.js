// Object.assign onto a literal that has every name of the source: the passing side of the tests of the source's own keys (its order, nothing outside a slot): each field is copied by a load and a store.
let log = "";
function use(s, k) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const t = Object.assign({ a: k, b: k, c: k }, s, { c: work });
  return Object.keys(t).join() + " " + t.a + " " + t.b + " " + t.c + " " + Object.hasOwn(t, "b");
}
function make(v) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return { b: v, a: work };
}
let last = "";
for (let n = 0; n < 300; n++) last = use(make(n), -1);
console.log(last);
console.log(use(make(undefined), -1));
console.log(use(Object.freeze(make(7)), -1));
const gone = make(8); delete gone.b;
console.log(use(gone, -1));
const again = make(9); delete again.b; again.b = 10;
console.log(use(again, -1));
const hidden = make(11); Object.defineProperty(hidden, "b", { enumerable: false });
console.log(use(hidden, -1));
const got = make(12); Object.defineProperty(got, "b", { get() { log += "g"; return 13; }, enumerable: true });
console.log(use(got, -1), log);
console.log(use(null, -1), use("", -1));
