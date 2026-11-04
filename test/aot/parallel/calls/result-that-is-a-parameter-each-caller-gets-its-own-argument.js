// A function hands back what it was handed, callers hand it objects of two classes, a number and a text, and each uses what it gets as what it passed.
// Under: --aot-testing=CheckProofsAtRunTime: the result of a call whose callee returns a parameter
class Circle { constructor(r) { this.r = r; } size() { return this.r * 2; } }
class Square { constructor(s) { this.s = s; } size() { return this.s; } }
function id(x) { return x; }
function round(r) { return id(new Circle(r)).size(); }
function flat(s) { return id(new Square(s)).size(); }
function number(n) { return id(n) + 1; }
function text(t) { return id(t).length; }
function looped() { let s = ""; for (let i = 0; i < 3; i++) s += round(i) + "/" + flat(i) + "/" + number(i) + "/" + text("t" + i) + ","; return s; }
console.log(round(2), flat(3), number(4), text("five"), looped());
