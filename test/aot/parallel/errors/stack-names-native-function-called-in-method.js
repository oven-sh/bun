// The stack of an error that a native function makes names that function, also where a method calls it.
// Flags: --aot-validate
const thing = {
  toString() {
    try {
      Bun.sleepSync(-1);
    } catch (error) {
      console.log(error.stack.split("\n").slice(0, 3).map(line => line.replace(/\(.*\)/, "").trim()).join(" < "));
    }
    return "thing";
  },
};
console.log(`${thing}`);
