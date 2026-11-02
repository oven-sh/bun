// The instance comes back from flatMap as a value the compiler cannot follow. The built-in still constructs the species, so C's constructor runs with arguments that native code chooses.
function passThrough(value) {
  return [value].flatMap(element => [element])[0];
}
const seen = [];
class C extends RegExp {
  constructor(a, b, c) {
    super(a, b, c);
    seen.push(
      [
        typeof a === "number" || typeof a === "string" ? JSON.stringify(a) : typeof a,
        typeof b === "number" || typeof b === "string" ? JSON.stringify(b) : typeof b,
        typeof c === "number" || typeof c === "string" ? JSON.stringify(c) : typeof c,
      ].join(),
    );
    this.first = a;
  }
}
const made = passThrough(new C(",", ""));
console.log("a,b".split(made).join("|"), seen.join("|"), typeof made.first);
