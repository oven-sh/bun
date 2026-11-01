// A constructor function that is made several times and told a name: the frame of a construction shows it.
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
const make = () => {
  function Plain() {
    this.n = 1;
    throw new Error("x");
  }
  Plain.prototype.m = 1;
  return Plain;
};
for (let i = 0; i < 3; i++) {
  const f = make();
  rename(f, "told" + i);
  console.log(
    f.name,
    frames(() => new f()),
  );
}
