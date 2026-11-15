// A method of a class that is made more than once and then renamed shows its new name in a frame.
const rename = (f, name) => Object.defineProperty(f, "name", { value: name });
const top = stack => stack.split("\n")[1].trim().split(" ").slice(0, 2).join(" ");
function make() {
  class Single {
    m() { return new Error("x").stack; }
    static s() { return new Error("x").stack; }
  }
  rename(Single.prototype.m, "renamedMethod");
  rename(Single.s, "renamedStatic");
  console.log(top(new Single().m()), "|", top(Single.s()), "|", Single.prototype.m.name, Single.s.name);
}
for (let turn = 0; turn < 3; turn++) make();
