// The name passes through five functions.
function a(name) {
  b(name);
}
function b(name) {
  c(name);
}
function c(name) {
  d(name);
}
function d(name) {
  e(name);
}
function e(name) {
  Object.defineProperty(Function.prototype, name, { value: 6, configurable: true });
}
a("mark");
console.log((() => 1).mark);
