// A list is made of a variable, of what a getter answers, and of the variable again, which the getter has changed meanwhile. Numbers are expected, and null arrives too.
// Flags: --aot-check=verify-each-pass
let out = "";
function fractions(start) {
  let n = start;
  out += JSON.stringify([].concat(n, { get now() { return (n = n * 4294967296); } }.now, n));
}
function integers(start) {
  let n = start;
  out += JSON.stringify([].concat(n, { get now() { return (n = n | 1); } }.now, n));
}
fractions(3.75);
fractions(null);
integers(6);
integers(null);
console.log(out);
