// The prototype object of a constructor that a factory made is replaced when it has made objects already.
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
const early = first(1);
first.Made.prototype = {
  kind: "replaced",
  run() {
    return this.held * 100;
  },
};
const late = first(2);
console.log(early.kind, early.run(), late.kind, late.run(), early instanceof first.Made, late instanceof first.Made);
console.log(second(() => 3).kind, second(() => 3).run());
first.Made.prototype.kind = "changed";
Object.getPrototypeOf(early).kind = "early changed";
console.log(early.kind, late.kind, first(4).kind);
