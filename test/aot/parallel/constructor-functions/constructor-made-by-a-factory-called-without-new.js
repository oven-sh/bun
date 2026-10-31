// A constructor that a factory made is called as a plain function, with an object of the other call as `this`.
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
const one = first(1);
const other = second(() => 2);
first.Made.call(other, 40);
second.Made.call(one, () => 50);
console.log(other.held, typeof one.held, one.kind, other.kind);
const plain = {};
first.Made.apply(plain, [7]);
console.log(plain.held, Object.keys(plain).join());
try {
  console.log(one.run());
} catch (error) {
  console.log(error.constructor.name);
}
console.log(second.Made.prototype.run.call({ held: () => "borrowed" }));
