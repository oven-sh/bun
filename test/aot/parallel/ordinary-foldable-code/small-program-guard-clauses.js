const LIMIT = 10;
const STRICT = true;
function check(n) {
  if (typeof n !== "number") return "not a number";
  if (Number.isNaN(n)) return "nan";
  if (STRICT && n > LIMIT) return "too big";
  if (n < 0) return "negative";
  return "ok";
}
console.log(check(5), check(50), check(-1), check("5"), check(NaN));
