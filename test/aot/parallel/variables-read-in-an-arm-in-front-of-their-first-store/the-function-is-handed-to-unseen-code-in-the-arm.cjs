const unseen = (0, eval)("(f) => f()");
var held;
function peek() { return typeof held + " " + (held === undefined); }
function same(x) { return x; }
const text = same(String(process.argv.length));
if (!(process.argv.length > 99)) {
  console.log(unseen(peek));
  process.exit(0);
  throw new Error("never reached");
}
held = text;
console.log(peek());
