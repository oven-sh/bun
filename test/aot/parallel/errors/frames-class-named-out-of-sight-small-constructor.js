// A class with a small constructor is told a name: the frame of the constructor shows it below the frame of what the constructor calls.
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
const make = () =>
  class Plain {
    constructor(x) {
      this.x = x;
      check(x);
    }
  };
for (let i = 0; i < 3; i++) {
  const f = make();
  rename(f, "told" + i);
  console.log(
    f.name,
    frames(() => new f(1)),
    new f(0).x,
  );
}
