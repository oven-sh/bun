var held;
function peek() { return typeof held + " " + held.length; }
function same(x) { return x; }
function mayThrow(n) { if (n > 99) throw new Error("many"); return n; }
try {
  mayThrow(process.argv.length);
} catch (error) {
  console.log(error.message);
} finally {
  held = same(String(process.argv.length));
}
console.log(peek());
