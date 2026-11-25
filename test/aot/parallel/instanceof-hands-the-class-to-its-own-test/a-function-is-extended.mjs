function make() {
  function Kind() {}
  Object.defineProperty(Kind, Symbol.hasInstance, { value(value) { return this.accepts(value); } });
  class Text extends Kind {
    static accepts(value) { return typeof value === "string"; }
  }
  return (value) => value instanceof Text;
}
const test = make();
console.log(test("ab"), test(1));
