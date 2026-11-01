// Flags: --aot-validate
// `formatter.format` is an accessor: it answers a function bound to the formatter. That function turns an object into a number, which runs code of the program, and does nothing else to it.
let count = 0;
function format(value) {
  const before = count;
  const text = new Intl.NumberFormat("en").format(value);
  return [before, count, text].join(" ");
}
const given = { [Symbol.toPrimitive]() { count += 3; return 5; } };
console.log(format(given), "|", format(given), "|", count);
