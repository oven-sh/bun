// Reflect.construct() runs the constructor of one call of a factory for the constructor of another, and for a class.
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
class Other {
  run() {
    return "of the class " + this.held;
  }
}
const forSecond = Reflect.construct(first.Made, [() => 5], second.Made);
const forClass = Reflect.construct(first.Made, [6], Other);
console.log(forSecond.kind, forSecond.run(), forSecond instanceof first.Made, forSecond instanceof second.Made);
console.log(forClass.kind, forClass.run(), forClass instanceof Other, forClass instanceof first.Made);
