// Function called once directly once by name: compiled answers as plain.
function f(x) {
  return typeof x === "number" ? x + 1 : "other:" + x;
}
console.log(f(1));
const table = { f };
console.log(table[Date.now() > 0 ? "f" : "g"]("s"));
