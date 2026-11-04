var held;
function peek() { return typeof held + " " + (held === undefined); }
function same(x) { return x; }
const text = same(String(process.argv.length));
switch (process.argv.length > 99) {
  case false:
    console.log(peek());
    process.exit(0);
    throw new Error("never reached");
}
held = text;
console.log(peek());
