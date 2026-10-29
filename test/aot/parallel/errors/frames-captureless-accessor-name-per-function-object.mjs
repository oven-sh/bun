// Todo: an accessor that captures nothing is called without its function object, so its frames show "set " for every function object once the name of one of them was looked up; plain Bun shows it for that one alone
// A class is evaluated repeatedly. Its setter captures nothing. Each row prints the first stack frame of the setter before and after `name` is looked up on that evaluation's own setter.
const firstFrame = stack =>
  stack
    .split("\n")[1]
    .trim()
    .replace(/ ?\(.*\)$/, "");
for (let round = 0; round < 3; round++) {
  class Again {
    set ofObjects(value) {
      this.stack = new Error("x" + value).stack;
    }
  }
  const holder = new Again();
  const frame = () => ((holder.ofObjects = 1), firstFrame(holder.stack));
  const before = frame();
  console.log([before, Object.getOwnPropertyDescriptor(Again.prototype, "ofObjects").set.name, frame()].join(" | "));
}
