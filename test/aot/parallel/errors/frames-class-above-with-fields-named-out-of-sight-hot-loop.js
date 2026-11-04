// The class above is told a name, and the class below is constructed in a loop that runs often: the frame that the call of super enters shows the name.
// The function that names it comes out of a callback of native code, so the compiler does not see which function objects it names.
function frames(f) {
  try {
    f();
  } catch (error) {
    return error.stack
      .split("\n")
      .slice(1, 4)
      .map(line => {
        const words = line.trim().split(" ");
        return words.length > 2 ? words.slice(1, -1).join(" ") : "(no name)";
      })
      .join("|");
  }
  return "no error";
}
const rename = JSON.parse("[0]").map(
  () => (f, name) => Object.defineProperty(f, "name", { value: name, configurable: true }),
)[0];
const make = () =>
  class Plain {
    constructor(x) {
      this.a = x;
      if (x === 2999) throw new Error("x");
    }
  };
for (let i = 0; i < 3; i++) {
  const f = make();
  class Child extends f {
    constructor(x) {
      super(x);
      this.c = 3;
    }
  }
  rename(f, "told" + i);
  console.log(
    f.name,
    frames(() => {
      let sum = 0;
      for (let j = 0; j < 3000; j++) sum += new Child(j).a;
      return sum;
    }),
  );
}
