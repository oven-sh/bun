function Base(a) { this.a = a; }
function Below(a) { Base.call(this, layCall(a)); }
Below.prototype = Object.create(Base.prototype);
function Counter(n) { this.n = n; }
Counter.of = function (n) { return new Counter(n + 1); };
globalThis.Base = Base;
globalThis.Counter = Counter;
function layCall(i) {
  if (i === 5) (0, eval)("Base.call = function (self, a) { self.a = 100; }");
  return i;
}
function replaceOf(i) {
  if (i === 5) (0, eval)("Counter.of = function (n) { return { n: 1000 }; }");
  return i;
}
function run(count) {
  let before = 0, after = 0;
  for (let i = 0; i < count; i++) {
    const found = Counter.of(replaceOf(i)).n + new Below(i).a;
    if (i < 5) before += found; else after += found;
  }
  return before + " " + after;
}
console.log(run(10));
