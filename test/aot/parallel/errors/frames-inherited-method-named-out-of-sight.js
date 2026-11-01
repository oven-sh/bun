// The method of the class above is told a name and called on an object of the class below: its frame shows the name.
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
    Plain(x) {
      throw new Error("x" + x);
    }
  };
for (let i = 0; i < 3; i++) {
  const C = make();
  class Child extends C {}
  rename(C.prototype.Plain, "told" + i);
  const o = new Child();
  console.log(
    o.Plain.name,
    frames(() => o.Plain(1)),
  );
}
