function make() {
  class Kind {
    static accepts() { return false; }
  }
  Object.defineProperty(Kind, Symbol.hasInstance, { value(value) { return this.accepts(value); } });
  class Text extends Kind {
    static accepts(value) { return typeof value === "string"; }
  }
  return (value) => value instanceof Text;
}
const test = make();
let text = "";
for (let i = 0; i < 300; i++) text = [test("ab"), test(i)].join();
console.log(text);
