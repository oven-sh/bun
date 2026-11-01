// Flags: --aot-validate
// `formatter.format` is an accessor: it answers a function bound to the formatter. That function turns an object into a number, which runs code of the program, and does nothing else to it.
const formatter = new Intl.NumberFormat("en");
const values = [{ valueOf() { return 1000; } }, {}, { valueOf() { return 0.5; } }];
console.log(values.map(formatter.format).join(" "), values.length);
