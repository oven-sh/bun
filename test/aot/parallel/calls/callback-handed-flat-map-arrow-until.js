// A loop hands a callback to flatMap in every turn. It is an arrow made in front of the loop until one turn replaces it with a class, which cannot be called.
class Declared { constructor(a) { this.a = a; } }
function use(callback) { return [1, 2].flatMap(callback); }
function walk(length) {
  let callback = a => a, out;
  for (let n = 0; n < length; n++) {
    if (n === 27) callback = class Q extends Declared { constructor(a) { super(a); this.q = 1; } };
    out = use(callback);
  }
  return out;
}
function attempt(length) { try { return String(walk(length)); } catch (error) { return error.constructor.name; } }
const answers = [];
for (let n = 0; n < 6; n++) answers.push(attempt(n % 2 ? 40 : 20));
console.log(answers.join(" "));
