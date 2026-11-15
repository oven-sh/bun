// The same with fractions, rounding and signs
function format(n) {
  const cents = Math.round(n * 100);
  const text = (cents < 0 ? "-" : "") + "$" + Math.floor(Math.abs(cents) / 100) + "." + String(Math.abs(cents) % 100).padStart(2, "0");
  return [text, n.toFixed(0), n.toFixed(3), Math.round(n), Math.ceil(n), Math.floor(n), Math.trunc(n), parseFloat(n.toFixed(1))].join(" ");
}
console.log(format(1.005));
console.log(format(-2.5));
console.log(format(0.1 + 0.2));
