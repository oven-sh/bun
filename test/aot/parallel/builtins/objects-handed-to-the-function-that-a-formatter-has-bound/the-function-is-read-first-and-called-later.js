// Flags: --aot-validate
// `formatter.format` is an accessor: it answers a function bound to the formatter. That function turns an object into a number, which runs code of the program, and does nothing else to it.
const format = new Intl.NumberFormat("en").format;
const given = { n: 1, valueOf() { return ++this.n; } };
console.log(format(given), format(given), given.n, format.name === "", format.length);
