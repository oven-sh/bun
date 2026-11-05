// A value that nothing is known of is stored into its own field. Only one literal of the program has a field of that name, and what that literal holds there is no such object.
function helper() { return 1; }
const withInteger = { own: 5, n: 1 };
const withText = { mine: "text", n: 2 };
const withFunction = { self: helper, n: 3 };
const withLiteral = { inner: { k: 4 }, n: 4 };
function intoOwn(o) { o.own = o; return o; }
function intoMine(o) { o.mine = o; return o; }
function intoSelf(o) { o.self = o; return o; }
function intoInner(o) { o.inner = o; return o; }
function twice(o) { o.own = o; o.own = o; return o.own; }
let circles = 0;
for (let turn = 0; turn < 3000; turn++) {
  const text = '{"n":' + turn + "}";
  const a = intoOwn(JSON.parse(text)), b = intoMine(JSON.parse(text)), c = intoSelf(JSON.parse(text)), d = intoInner(JSON.parse(text)), e = twice(JSON.parse(text));
  if (a.own === a && b.mine === b && c.self === c && d.inner === d && e.own === e && a.n === turn) circles++;
}
console.log(circles, withInteger.own + 1, withText.mine + "!", withFunction.self(), withLiteral.inner.k);
