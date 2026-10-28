// A program puts functions without parameters on the prototypes of Map and Set. The module that copies the built-in classes calls
// each of them while it is first loaded. Prints the frames that each of them sees inside library modules.
const stacks = [];
for (const [name, holder] of [
  ["Map", Map.prototype],
  ["Set", Set.prototype],
  ["WeakMap", WeakMap.prototype],
]) {
  for (const key of ["added", Symbol.for("added")]) {
    Object.defineProperty(holder, key, {
      configurable: true,
      value() {
        stacks.push(
          name +
            " " +
            String(key) +
            " " +
            (this instanceof Map || this instanceof Set) +
            "\n" +
            new Error("seen").stack,
        );
      },
    });
  }
}
const text = require("node:util").inspect(new Map([[1, new Set([2])]]));
console.log(text, stacks.length);
for (const stack of stacks) {
  const [title, , ...frames] = stack.split("\n");
  console.log(title);
  for (const frame of frames) {
    if (/\((?:node|internal|bun):\S+:\d+:\d+\)$|\(unknown\)$|\(native\)$/.test(frame)) console.log(frame);
  }
}
