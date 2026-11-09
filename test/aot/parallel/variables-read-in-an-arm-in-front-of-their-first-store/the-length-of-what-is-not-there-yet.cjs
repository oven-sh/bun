var held;
function used(o) { return o.length; }
function attempt() { try { return used(held); } catch (error) { return error.constructor.name; } }
function same(x) { return x; }
const text = same(String(process.argv.length));
if (!(process.argv.length > 99)) {
  console.log(attempt());
  process.exit(0);
  throw new Error("never reached");
}
held = text;
console.log(attempt());
