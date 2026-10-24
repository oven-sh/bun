function body() {
  function A() {}
  A.prototype.kind = "mine";
  return new A();
}
console.log(body().kind, body().kind);
