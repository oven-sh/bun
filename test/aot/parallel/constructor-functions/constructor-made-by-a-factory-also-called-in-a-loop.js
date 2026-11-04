// The factory is called where the module's body runs once and in a loop as well: the constructors of the loop are as many functions as it has turns.
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
const many = [];
for (const kind of ["a", "b", "c"]) {
  many.push(
    makeMaker({
      kind,
      run() {
        return kind + this.held;
      },
    }),
  );
}
console.log(
  many.map(maker => maker(1).run()).join(),
  many[0].Made === many[1].Made,
  many[0](1) instanceof many[1].Made,
);
console.log(
  first(1).run(),
  second(() => 2).run(),
  many[2](3) instanceof many[2].Made,
  many[2](3) instanceof first.Made,
);
