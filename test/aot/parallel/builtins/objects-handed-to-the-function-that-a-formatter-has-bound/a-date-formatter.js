// Flags: --aot-validate
// `formatter.format` is an accessor: it answers a function bound to the formatter. That function turns an object into a number, which runs code of the program, and does nothing else to it.
let hits = 0;
const formatter = new Intl.DateTimeFormat("en", { timeZone: "UTC" });
console.log(formatter.format({ valueOf() { hits++; return 0; } }), hits);
