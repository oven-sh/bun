function makeOwn() {
  class Even {
    static [Symbol.hasInstance](value) { return this.test(value); }
    static test(value) { return value % 2 === 0; }
  }
  return (value) => value instanceof Even;
}
try { console.log(String(makeOwn()(2))); } catch (error) { console.log(error.name + ": " + error.message); }
