// Two levels of classes over a constructor function, where nobody constructs the middle class itself: with one subclass and with two.
function A() { this.x = 1; }
A.prototype.m = function () { return "A.m"; };
class Middle extends A {}
class B extends Middle { m() { return "B.m"; } }
const b = new B();
console.log(b.x, b.m(), b instanceof A);
class Fork extends A {}
class Left extends Fork { left = 2; }
class Right extends Fork { right = "r"; }
const l = new Left(), r = new Right();
console.log(JSON.stringify(l), JSON.stringify(r), l.m(), l instanceof Fork, l instanceof Right, r instanceof Right);
