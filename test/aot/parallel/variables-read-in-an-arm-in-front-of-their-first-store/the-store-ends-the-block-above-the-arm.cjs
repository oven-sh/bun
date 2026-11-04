var held;
function peek() { return typeof held + " " + (held === undefined); }
function same(x) { return x; }
held = same(String(process.argv.length));
if (!(process.argv.length > 99)) {
  console.log(peek());
  process.exit(0);
  throw new Error("never reached");
}
console.log(peek());
