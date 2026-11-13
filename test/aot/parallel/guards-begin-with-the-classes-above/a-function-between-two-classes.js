// A constructor function stands below a class and above another. In turn five unseen text replaces a method of the class at the top, which the methods of both below come to.
class Top { top() { return this.a + 1; } }
function Middle(a) { this.a = a; }
Object.setPrototypeOf(Middle.prototype, Top.prototype);
Middle.prototype.middle = function () { return this.top() * 2; };
class Bottom extends Middle { constructor(a) { super(a); this.c = 3; } bottom() { return this.middle() + this.c; } }
globalThis.classes = { Top, Middle, Bottom };
const change = (text) => (0, eval)(text);
function lowestFirst(count) {
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (i === 5) change("classes.Top.prototype.top = function () { return 100; };");
    const low = new Bottom(i);
    total += low.bottom();
  }
  return total;
}
function middleBehind(count) {
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (i === 5) change("classes.Middle.prototype.middle = function () { return this.top() * 3; };");
    const middle = new Middle(i);
    const low = new Bottom(i);
    total += middle.middle() + low.bottom();
  }
  return total;
}
console.log(lowestFirst(10), middleBehind(10));
