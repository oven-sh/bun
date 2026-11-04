// A stack that is taken before the class is told its name and read behind it shows the name, as a stack that is taken behind it does.
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
    constructor() {
      throw new Error("x");
    }
  };
for (let i = 0; i < 3; i++) {
  const f = make();
  let caught;
  try {
    new f();
  } catch (error) {
    caught = error;
  }
  rename(f, "told" + i);
  console.log(
    f.name,
    caught.stack.split("\n")[1].trim().split(" ").slice(1, -1).join(" "),
    frames(() => new f()),
  );
}
