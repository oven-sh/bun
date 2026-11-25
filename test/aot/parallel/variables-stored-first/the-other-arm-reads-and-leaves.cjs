var held;
function peek() { return typeof held + " " + (held === undefined); }
function same(x) { return x; }
const text = same(String(process.argv.length));
if (process.argv.length > 99) {
  held = text;
} else {
  console.log(peek()); process.exit(0); throw 0;
}
console.log(peek());
