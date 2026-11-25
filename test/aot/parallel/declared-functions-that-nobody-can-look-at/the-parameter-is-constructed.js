function outer() {
  function build(Maker) { return new Maker(); }
  function Thing() { this.n = 1; }
  function ask() { return build(Thing); }
  const a = ask(), b = ask();
  return [Object.getPrototypeOf(a) === Object.getPrototypeOf(b), a instanceof Thing, a.constructor === b.constructor].join();
}
console.log(outer());
