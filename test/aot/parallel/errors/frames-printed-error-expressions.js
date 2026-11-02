// Prints the frames that console.log shows under an error that a constructor throws below three expressions that construct.
class Inner {
  constructor(value) {
    if (value) throw new RangeError("out of range");
  }
}
const holder = { Middle: function Middle(value) { this.inner = new Inner(value); } };
function make(value) {
  const made = new holder.Middle(value);
  return made;
}
function makeOverLines(value) {
  return new
    holder.Middle(
      value,
    );
}
for (const maker of [make, makeOverLines, value => Reflect.construct(holder.Middle, [value])]) {
  try {
    console.log(typeof [new Inner(0), maker(1)]);
  } catch (error) {
    const frames = Bun.inspect(error, { colors: false }).split("\n").filter(line => /^\s+at /.test(line));
    console.log(frames.map(line => line.trim().replace(/\(?[^ (]*[\\/]/, "")).join("\n"));
  }
}
