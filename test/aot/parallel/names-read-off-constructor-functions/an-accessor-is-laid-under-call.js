function Base(a) { this.a = a; }
function Below(a) { Base.call(this, a + 1); }
globalThis.Base = Base;
function run(count) {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    if (i === 5) (0, eval)("var asked = 0; Object.defineProperty(Base, 'call', { get() { asked++; return function (self, a) { self.a = 1000 + a; }; } })");
    sum += new Below(i).a;
  }
  return sum + " " + asked;
}
console.log(run(10));
