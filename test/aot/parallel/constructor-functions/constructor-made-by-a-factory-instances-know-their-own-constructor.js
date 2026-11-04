// The constructors of two calls of a factory are two functions: an object is an instance of the one that made it alone.
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
console.log(
  one instanceof first.Made,
  one instanceof second.Made,
  other instanceof first.Made,
  other instanceof second.Made,
);
console.log(
  first.Made === second.Made,
  first.Made.prototype === second.Made.prototype,
  Object.getPrototypeOf(one) === first.Made.prototype,
);
console.log(
  one.constructor === Object,
  first.Made.name,
  second.Made.name,
  first.Made.length,
  String(first.Made) === String(second.Made),
);
