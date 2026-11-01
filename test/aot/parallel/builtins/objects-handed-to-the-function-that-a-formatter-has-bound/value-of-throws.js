// Flags: --aot-validate
// `formatter.format` is an accessor: it answers a function bound to the formatter. That function turns an object into a number, which runs code of the program, and does nothing else to it.
const given = { kept: 1, valueOf() { this.kept = 2; throw new RangeError("no number"); } };
try {
  console.log(new Intl.NumberFormat("en").format(given));
} catch (error) {
  console.log(error.name, error.message, given.kept);
}
