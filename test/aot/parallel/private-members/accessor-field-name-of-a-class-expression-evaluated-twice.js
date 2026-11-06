// A class expression with an `accessor` field is evaluated twice. Each class asks before the value and tells its own instances from those of the other
const lines = [];
function make(start) {
  return class Made {
    before = #count in this;
    accessor #count = start;
    static has(value) {
      return #count in value;
    }
    static bump(value) {
      return ++value.#count;
    }
  };
}
const One = make(10);
const Two = make(20);
const one = new One();
const two = new Two();
lines.push("before the value: " + one.before + " " + two.before);
lines.push("its own instances: " + One.has(one) + " " + Two.has(two));
lines.push("those of the other: " + One.has(two) + " " + Two.has(one));
lines.push("values: " + One.bump(one) + " " + Two.bump(two));
console.log(lines.join("\n"));
