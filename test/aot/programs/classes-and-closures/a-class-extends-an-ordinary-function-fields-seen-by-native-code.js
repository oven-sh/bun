// A class extends an ordinary function: native code lists, prints and copies the fields.
function two() { return 2; }
class Extended extends two {
  x = 1;
  name = "n";
  get() { return this.x; }
}
const made = new Extended();
console.log(made.x, made.get(), Object.keys(made).join(), JSON.stringify(made));
console.log(made);
console.log({ ...made }, Object.entries(made), structuredClone(made));
