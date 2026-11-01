// Four class objects of one class, the method of three of them told a name of its own: the frame shows the name of the function object that was called.
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
const all = [make(), make(), make(), make()];
all.forEach((C, i) => {
  if (i !== 2) rename(C.prototype.Plain, "told" + i);
});
for (const C of all.reverse()) {
  const o = new C();
  console.log(
    o.Plain.name,
    frames(() => o.Plain(1)),
  );
}
