// A direct eval stores into the names of the file. Code that was compiled for the names as they are written is left from then on.
var run = function (source) { return eval(source); };
function A(n) { this.n = n; }
A.prototype.get = function () { return "a" + this.n; };
function B(n) { this.n = -n; }
B.prototype.get = function () { return "b" + this.n; };
var C = A;
var step = 1;
var helper = function (x) { return x + step; };
function make(n) { return new C(n); }
function loop(n) {
  var out = [];
  for (var i = 0; i < n; i++) {
    var o = make(i);
    out.push(o.get(), o instanceof A, helper(i));
  }
  return out.join();
}
console.log(loop(3));
run("step = 5");
console.log(loop(2));
run("C = B");
console.log(loop(2));
run("helper = function (x) { return 'h' + x; }");
console.log(loop(2));
run("make = function (n) { return new A(n + 7); }");
console.log(loop(2));
