// The frames of the constructors that a factory made carry the name that is written.
const makeMaker = kind => {
  const Made = function (value) {
    if (value < 0) throw new RangeError(kind + " takes no " + value);
    this.held = value;
  };
  Made.prototype = { kind };
  return value => new Made(value);
};
const first = makeMaker("first");
const second = makeMaker("second");
for (const make of [first, second]) {
  try {
    make(-1);
  } catch (error) {
    console.log(
      error.message,
      error.stack
        .split("\n")
        .slice(1, 3)
        .map(line => line.trim().split(" ")[1])
        .join(),
    );
  }
}
console.log(first(1).kind, second(2).kind);
