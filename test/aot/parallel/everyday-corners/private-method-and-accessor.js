// Private method and accessor: compiled answers as plain.
class A {
  #m() {
    return 1;
  }
  get #g() {
    return 2;
  }
  set #g(v) {
    this.s = v;
  }
  run() {
    this.#g = 5;
    return [this.#m(), this.#g, this.s].join();
  }
}
console.log(new A().run());
