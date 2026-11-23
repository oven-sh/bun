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
