// Each call of the factory makes a constructor with a prototype object of its own. One loop makes objects of both and calls the method that each finds there.
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
let sum = 0;
for (let turn = 0; turn < 20000; ++turn) {
  const one = first(turn);
  const other = second(() => turn);
  sum += one.run() + other.run();
}
console.log(sum, first(1).kind, second(() => 2).kind);
