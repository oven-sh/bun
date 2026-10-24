function body() {
  function A(x) {
    this.value = x;
  }
  return new A(1) instanceof A;
}
console.log(body(), body());
