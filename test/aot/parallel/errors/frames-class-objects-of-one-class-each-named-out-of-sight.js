// Four class objects of one class, three of them told a name of their own: the frame of a constructor shows the name of the class object that was constructed.
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
const all = [make(), make(), make(), make()];
all.forEach((f, i) => {
  if (i !== 2) rename(f, "told" + i);
});
for (const f of all.reverse())
  console.log(
    f.name,
    frames(() => new f()),
  );
