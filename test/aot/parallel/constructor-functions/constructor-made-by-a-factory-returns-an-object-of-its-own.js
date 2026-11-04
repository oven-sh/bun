// A constructor that a factory made returns another object than the one it was handed, in some of its calls.
const makeMaker = kind => {
  const cache = new Map();
  const Made = function (value) {
    if (cache.has(value)) return cache.get(value);
    this.held = value;
    cache.set(value, this);
  };
  Made.prototype = { kind };
  return value => new Made(value);
};
const first = makeMaker("first");
const second = makeMaker("second");
console.log(
  first(1) === first(1),
  first(1) === second(1),
  first(2) === first(1),
  first(1).kind,
  second(1).kind,
  first(2).held,
);
