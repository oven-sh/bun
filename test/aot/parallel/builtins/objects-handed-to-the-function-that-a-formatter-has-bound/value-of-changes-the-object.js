// Flags: --aot-validate
// `formatter.format` is an accessor: it answers a function bound to the formatter. That function turns an object into a number, which runs code of the program, and does nothing else to it.
let hits = 0;
function format(value) {
  const before = value.n;
  const text = new Intl.NumberFormat("en").format(value);
  return [before, value.n, text, hits].join(" ");
}
const given = { n: 1, valueOf() { hits++; this.n += 10; return 42; } };
console.log(format(given), "|", format(given), "|", given.n);
