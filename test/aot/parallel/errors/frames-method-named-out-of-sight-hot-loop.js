// A method is told a name and called in a loop that runs often: its frame shows the name.
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
      if (x === 4999) throw new Error("x");
      return x;
    }
  };
for (let i = 0; i < 3; i++) {
  const C = make();
  rename(C.prototype.Plain, "told" + i);
  const o = new C();
  console.log(
    o.Plain.name,
    frames(() => {
      let sum = 0;
      for (let j = 0; j < 5000; j++) sum += o.Plain(j);
      return sum;
    }),
  );
}
