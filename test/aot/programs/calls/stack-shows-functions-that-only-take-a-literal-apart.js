// A function that only takes its argument apart is still in the stack that a getter, a trap or a failed read captures while it reads.
function names(error) {
  return String(error.stack).split("\n").slice(1).map(line => line.trim().split(" ")[1]).filter(name => /^[a-zA-Z]+$/.test(name)).join(" < ");
}
function sum(o) { return o.a + o.b; }
function first(o) { const a = o.a; return [a, o.b]; }
function nested(o) { return sum({ a: o.a, b: 1 }) + o.b; }
function attempt(label, run) {
  let result;
  try { result = "returned " + run(); } catch (error) { result = names(error); }
  console.log(label + ": " + result);
}
function main() {
  attempt("a getter, two reads", function direct() { return "" + sum({ get a() { throw new Error("read"); }, b: 2 }); });
  attempt("a getter, second read", function direct() { return "" + sum({ a: 1, get b() { throw new Error("read"); } }); });
  attempt("a getter, one read", function direct() { return "" + first({ get a() { throw new Error("read"); }, b: 2 }); });
  attempt("a getter, two levels", function direct() { return "" + nested({ get a() { throw new Error("read"); }, b: 2 }); });
  attempt("no getter", function direct() { return "" + sum({ a: 1, b: 2 }); });
  attempt("nothing to read from", function direct() { return "" + sum(undefined); });
  attempt("a trap", function direct() { return "" + sum(new Proxy({}, { get: function trap() { throw new Error("trap"); } })); });
}
main();
