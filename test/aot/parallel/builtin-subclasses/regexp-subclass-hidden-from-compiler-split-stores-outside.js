// The instance comes back from flatMap as a value the compiler cannot follow. The built-in still constructs the species, so C's constructor runs with arguments that native code chooses.
function passThrough(value) {
  return [value].flatMap(element => [element])[0];
}
const held = { c: 1 };
class C extends RegExp {
  constructor(a, b) {
    super(a, b);
    held.index = held.c;
  }
}
const made = passThrough(new C(",", ""));
console.log("a,b".split(made).join("|"), held.index);
