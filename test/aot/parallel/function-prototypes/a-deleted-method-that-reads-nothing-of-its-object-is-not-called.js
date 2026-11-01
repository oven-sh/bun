// As a-method-deleted-before-the-first-object-of-its-function-is-made-is-not-called.js, with a method that never looks at `this`: nothing at all is left of the object.
function five() {
  return 5;
}
function A() {
  return this;
}
A.prototype.five = five;
function B() {
  return A.call(this);
}
B.prototype.five = five;
console.log(new B().five());
delete A.prototype.five;
try {
  console.log(new A().five());
} catch (error) {
  console.log(error instanceof TypeError ? "TypeError" : "another error");
}
console.log(new B().five());
