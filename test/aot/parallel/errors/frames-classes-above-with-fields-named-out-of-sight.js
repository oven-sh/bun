// Three classes whose constructors store fields, the upper two told names: each frame shows the name of its own class object.
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
function check(x) {
  if (x) throw new Error("x");
}
const makeBase = () =>
  class Base {
    constructor(x) {
      this.a = 1;
      check(x);
    }
  };
const makeMiddle = Base =>
  class Plain extends Base {
    constructor(x) {
      super(x);
      this.b = 2;
    }
  };
for (let i = 0; i < 3; i++) {
  const base = makeBase();
  const f = makeMiddle(base);
  class Child extends f {
    constructor(x) {
      super(x);
      this.c = 3;
    }
  }
  rename(f, "told" + i);
  rename(base, "base" + i);
  const made = new Child(0);
  console.log(
    f.name,
    frames(() => new Child(1)),
    made.a + made.b + made.c,
  );
}
