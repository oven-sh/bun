// new.target, arguments.callee and the name of a function expression tell which function object runs.
function ReadsNewTarget() {
  this.target = new.target === ReadsNewTarget;
}
function ReadsCallee() {
  this.callee = arguments.callee === ReadsCallee;
}
var Named = function Self() {
  this.self = Self === Named;
};
function A() {}
function B() {}
function C() {}
A.prototype = new ReadsNewTarget();
B.prototype = new ReadsCallee();
C.prototype = new Named();
console.log(new A().target, new B().callee, new C().self);
