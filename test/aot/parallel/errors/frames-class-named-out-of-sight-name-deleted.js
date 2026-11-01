// A class is told a name, which is then deleted: the frame of the constructor shows the name, and then the name as it is written.
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
  rename(f, "told" + i);
  const before = frames(() => new f());
  delete f.name;
  console.log(
    String(f.name),
    before,
    frames(() => new f()),
  );
}
