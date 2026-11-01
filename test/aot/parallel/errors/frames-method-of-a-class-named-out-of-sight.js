// A class is made several times, and its method is told a name each time: the frame of the method shows it.
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
  class Holder {
    Plain() {
      throw new Error("x");
    }
  };
for (let i = 0; i < 3; i++) {
  const C = make();
  rename(C.prototype.Plain, "told" + i);
  const o = new C();
  console.log(
    o.Plain.name,
    frames(() => o.Plain()),
  );
}
