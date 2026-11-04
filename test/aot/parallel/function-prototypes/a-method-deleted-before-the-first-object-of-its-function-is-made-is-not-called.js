// Two constructor functions share a call: A returns `this`, so what `new A` gives may be an object of B.
// The method goes from A.prototype before the first object of A is made, and the compiler need not make that object at all.
function twice() {
  return this.x * 2;
}
function A(x) {
  this.x = x;
  return this;
}
A.prototype.twice = twice;
function B(x) {
  return A.call(this, x);
}
B.prototype.twice = twice;
console.log(new B(1).twice());
delete A.prototype.twice;
try {
  console.log(new A(8).twice());
} catch (error) {
  console.log(error instanceof TypeError ? "TypeError" : "another error");
}
console.log(new B(3).twice());
