// What the constructor stores differs from call to call of the factory: a number here, a function there, and a field that only some objects get.
const makeMaker = (kind, extra) => {
  const Made = function (value) {
    this.held = value;
    if (extra) this.extra = extra(value);
  };
  Made.prototype = {
    kind,
    describe() {
      return this.kind + ":" + typeof this.held + ":" + ("extra" in this ? this.extra : "none");
    },
  };
  return value => new Made(value);
};
const numbers = makeMaker("numbers");
const functions = makeMaker("functions", value => value());
const texts = makeMaker("texts", value => value.length);
console.log(numbers(1).describe(), functions(() => 2).describe(), texts("three").describe());
console.log(Object.keys(numbers(1)).join(), Object.keys(functions(() => 2)).join(), JSON.stringify(texts("x")));
