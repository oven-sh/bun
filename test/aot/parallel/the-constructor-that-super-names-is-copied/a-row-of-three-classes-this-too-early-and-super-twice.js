// Three classes in a row, each with a field and a store. `this` in front of `super(..)` throws and makes nothing; a second `super(..)` runs the constructors above once more and then throws.
let made = 0;
class Top { a; constructor(x) { made++; this.a = x; } }
class Middle extends Top { b; constructor(x) { super(x + 1); this.b = x; } }
class Bottom extends Middle { c; constructor(x, fault) { if (fault === 1) this.c = 0; super(x + 1); if (fault === 2) super(x); this.c = x; } }
function run(count) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    let text;
    try {
      const one = new Bottom(i, i % 4);
      text = one.a + "" + one.b + one.c + Object.keys(one).join("");
    } catch (error) {
      text = error.constructor.name;
    }
    parts.push(text + made);
  }
  const middle = new Middle(50);
  parts.push(middle.a + "" + middle.b + Object.keys(middle).join("") + made);
  return parts.join(" ");
}
console.log(run(9));
