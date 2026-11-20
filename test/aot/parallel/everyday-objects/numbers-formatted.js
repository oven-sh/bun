// Numbers as texts: fixed, precise, in bases, padded, grouped
function format(n) {
  const grouped = String(Math.trunc(n)).replace(/\B(?=(\d{3})+$)/g, ",");
  return [n.toFixed(2), n.toPrecision(3), n.toString(2).slice(0, 10), n.toString(36).slice(0, 8), grouped, String(n).padStart(8, "*"), n.toExponential(1), Number(n.toFixed(1))].join(" ");
}
console.log(format(1234567));
console.log(format(255));
console.log(format(7));
