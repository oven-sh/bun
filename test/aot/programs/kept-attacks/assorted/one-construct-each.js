// Assorted: one construct each. It prints what plain Bun prints.
function other(a, b) {
  return a.n + b.n;
}
function* both(x, y) {
  yield x;
  yield y;
}
class Made {
  constructor(tag, n, a) {
    this.tag = tag;
    this.n = n;
    this.a = a;
  }
}
function diesInLiteral(p) {
  const o = { a: p };
  return 1;
}
function diesInLiteralThatIsRead(p) {
  const o = { a: p, n: 2 };
  return o.n;
}
function diesInArray(p) {
  const l = [p];
  return l.length;
}
function throughApply(p, q) {
  return other.apply(null, [p, q]);
}
function throughCall(p, q) {
  return other.call(null, p, q);
}
function throughBind(p, q) {
  const f = other.bind(null, p);
  return f(q);
}
function throughGenerator(p, q) {
  let s = 0;
  for (const v of both(p, q)) s += v.n;
  return s;
}
function throughNew(p) {
  const m = new Made("t", 1, p);
  return m.n;
}
function storedIntoWhatWasReadOut(p, q) {
  const l = [q];
  l[0].b = p;
  return 1;
}
function closureThatDies(p) {
  const g = v => p.n + v;
  return 1;
}
let sum = 0;
for (let i = 0; i < 300; i++) {
  const p = { n: i, b: null };
  const q = { n: i + 1, b: null };
  sum += diesInLiteral(p) + diesInLiteralThatIsRead(p) + diesInArray(p) + throughApply(p, q) + throughCall(p, q) + throughBind(p, q);
  sum += throughGenerator(p, q) + throughNew(p) + storedIntoWhatWasReadOut(p, q) + closureThatDies(p);
}
console.log(sum);
