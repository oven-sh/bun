// A stack that is taken before the method is told its name and read behind it shows the name, as a stack that is taken behind it does.
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
  const o = new C();
  let caught;
  try {
    o.Plain(1);
  } catch (error) {
    caught = error;
  }
  rename(C.prototype.Plain, "told" + i);
  console.log(
    o.Plain.name,
    caught.stack.split("\n")[1].trim().split(" ").slice(1, -1).join(" "),
    frames(() => o.Plain(1)),
  );
}
