// A class and a constructor function stand below the constructors that a factory made.
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
class Below extends first.Made {
  constructor(value) {
    super(value * 2);
    this.own = "own";
  }
  run() {
    return super.run() + 1000;
  }
}
function Old(value) {
  second.Made.call(this, value);
}
Old.prototype = Object.create(second.Made.prototype);
const below = new Below(4);
const old = new Old(() => "old");
console.log(below.run(), below.kind, below.own, below instanceof first.Made, below instanceof second.Made);
console.log(old.run(), old.kind, old instanceof second.Made, old instanceof first.Made);
