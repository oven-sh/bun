// A function of the program that runs while library modules are first loaded sees the bodies of those modules in its stack: each under the name of its module, at the place where it asks for the next module.
const stacks = [];
const custom = Symbol.for("nodejs.util.inspect.custom");
for (const holder of [Array.prototype, Map.prototype]) {
  Object.defineProperty(holder, custom, {
    configurable: true,
    value() {
      stacks.push(new Error("seen").stack);
      return "inspected";
    },
  });
}
const text = Bun.inspect([20]);
delete Map.prototype[custom];
delete Array.prototype[custom];
console.log(text, stacks.length);
for (const stack of stacks) {
  const bodies = stack.split("\n").filter(frame => /^\s+at ((?:node|internal|bun):\S+) \(\1:\d+:\d+\)$/.test(frame));
  // The module that copies the built-in classes is compiled from a text of its own.
  const isOfCopies = frame => frame.includes("internal:primordials");
  console.log(bodies.filter(frame => !isOfCopies(frame)).map(frame => frame.trim()));
  console.log(bodies.filter(isOfCopies).map(frame => frame.trim().replace(/:\d+:\d+\)$/, ")")));
}
