// A test made in front of a yield decides a branch behind it, and the branch narrows what was tested.
function* twice(x) {
  if (x) yield x.a;
  yield "between";
  if (x) yield x.b;
}
console.log([...twice({ a: 1, b: 2 })], [...twice(null)], [...twice(process.argv.length > 99 ? null : { a: "p", b: "q" })]);
function make(n) {
  const a = [n, 2, 3, 4];
  if (n > 100) return null;
  const p = a.values();
  p.next();
  return p;
}
function* user(n) {
  const x = make(n);
  yield "first";
  yield x && [...x];
  yield x && [...x];
}
console.log([...user(3)], [...user(process.argv.length + 2)], [...user(process.argv.length + 200)]);
function* inALoop(v, n) {
  const isText = typeof v === "string";
  for (let i = 0; i < n; i++) {
    if (isText) yield v.length + i;
    else yield v;
  }
}
console.log([...inALoop("abc", 2)], [...inALoop(7, 2)], [...inALoop(process.argv.length > 99 ? 1 : "de", 3)]);
function* listOrNot(v) {
  const isList = Array.isArray(v);
  yield isList;
  if (isList) yield v.length;
  yield "end";
  if (isList) yield v[0];
}
console.log([...listOrNot([5, 6])], [...listOrNot("no")], [...listOrNot(process.argv.length > 99 ? 0 : [9])]);
class P { constructor(x) { this.x = x; } }
function* instanceOrNot(v) {
  const is = v instanceof P;
  yield 1;
  if (is) yield v.x;
  yield 2;
  if (!is) yield "other";
  else yield v.x + 1;
}
console.log([...instanceOrNot(new P(4))], [...instanceOrNot({})], [...instanceOrNot(process.argv.length > 99 ? {} : new P(8))]);
function* undefinedOrNot(o) {
  const v = o.k;
  if (v !== undefined) yield v.length;
  yield "mid";
  if (v !== undefined) yield v.toUpperCase();
}
console.log([...undefinedOrNot({ k: "abc" })], [...undefinedOrNot({})], [...undefinedOrNot(process.argv.length > 99 ? {} : { k: "z" })]);
