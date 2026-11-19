var early;
var late;
function peek() { return typeof early + " " + typeof late; }
function same(x) { return x; }
const text = same(String(process.argv.length));
early = text;
if (!(process.argv.length > 99)) {
  console.log(peek());
  process.exit(0);
  throw new Error("never reached");
}
late = text;
console.log(peek());
