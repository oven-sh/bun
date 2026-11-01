// The constructor that a factory made goes where nobody sees what is done with it, and comes back.
const makePrototype = options => ({ kind: options.kind, run: options.run });
const makeMaker = options => {
  const prototype = makePrototype(options);
  const Made = function (value) {
    this.held = value;
  };
  Made.prototype = prototype;
  const make = value => new Made(value);
  make.Made = Made;
  return make;
};
const first = makeMaker({
  kind: "first",
  run() {
    return this.held + 1;
  },
});
const second = makeMaker({
  kind: "second",
  run() {
    return this.held();
  },
});
const hidden = [first.Made, second.Made].map(made => made);
const one = new hidden[0](10);
const other = new hidden[1](() => 20);
console.log(one.run(), other.run(), one instanceof first.Made, other instanceof second.Made, hidden[0] === first.Made);
const methods = [one, other].map(object => object.run);
console.log(methods[0].call({ held: 1 }), methods[1].call({ held: () => 2 }));
