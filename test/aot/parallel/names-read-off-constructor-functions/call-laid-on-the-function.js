function Base(a) { this.a = a; }
function Below(a, b) { Base.call(this, a); this.b = b; }
Below.prototype = Object.create(Base.prototype);
globalThis.Base = Base;
function run(count) {
  let before = 0, after = 0;
  for (let i = 0; i < count; i++) {
    if (i === 5) (0, eval)("Base.call = function (self, a) { self.a = a + 100; }");
    if (i < 5) before += new Below(i, 1).a; else after += new Below(i, 1).a;
  }
  return before + " " + after;
}
console.log(run(10));
