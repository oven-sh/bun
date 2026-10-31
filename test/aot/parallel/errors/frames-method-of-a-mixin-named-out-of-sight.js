// A mixin makes a class for each parent, and the method of each is told a name of its own: its frame shows it.
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
const mixin = Base =>
  class Mixed extends Base {
    Plain(x) {
      throw new Error("x" + x);
    }
  };
class A {}
class B {}
for (const Base of [A, B, A]) {
  const C = mixin(Base);
  rename(C.prototype.Plain, "of" + Base.name);
  const o = new C();
  console.log(
    o.Plain.name,
    frames(() => o.Plain(1)),
  );
}
