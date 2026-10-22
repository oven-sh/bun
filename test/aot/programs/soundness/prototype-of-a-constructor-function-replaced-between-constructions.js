function A(p) {
  this.x = p;
  this.r = this.m ? this.m() : "no m";
}
A.prototype.m = function () {
  return "A.m";
};
function T() {}
function make(p) {
  return Reflect.construct(A, [p], T);
}
T.prototype = { __proto__: A.prototype, first: true };
const one = make(1);
T.prototype = { __proto__: A.prototype, m() { return "second.m"; } };
const two = make(2);
Object.defineProperty(T, "prototype", { value: { third: true } });
const three = make(3);
for (const o of [one, two, three]) console.log(o.x, o.r, o.first, o.third, o instanceof A, o instanceof T);

const early = new F(0);
function F(p) {
  this.x = p;
}
F.prototype = { constructor: F, m() { return "F.m"; } };
const late = new F(1);
console.log(typeof early.m, early instanceof F, late.m(), late instanceof F);
