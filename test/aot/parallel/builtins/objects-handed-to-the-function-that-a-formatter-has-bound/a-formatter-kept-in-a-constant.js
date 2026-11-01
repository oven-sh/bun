// Flags: --aot-validate
// `formatter.format` is an accessor: it answers a function bound to the formatter. That function turns an object into a number, which runs code of the program, and does nothing else to it.
const formatter = new Intl.NumberFormat("en");
for (const value of [{}, { valueOf() { return 1234.5; } }, { toString() { return "7"; } }]) console.log(formatter.format(value));
