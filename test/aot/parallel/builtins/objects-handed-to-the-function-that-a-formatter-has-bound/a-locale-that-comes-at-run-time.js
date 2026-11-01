// Flags: --aot-validate
// `formatter.format` is an accessor: it answers a function bound to the formatter. That function turns an object into a number, which runs code of the program, and does nothing else to it.
// The build knows no pattern for these two formatters.
const locale = process.argv.length > 99 ? "de" : "en";
let hits = 0;
const given = { n: 1, valueOf() { hits++; this.n += 10; return 86400000; } };
console.log(new Intl.NumberFormat(locale).format(given), new Intl.NumberFormat(locale).format({}), given.n, hits);
console.log(new Intl.DateTimeFormat(locale, { timeZone: "UTC" }).format(given), given.n, hits);
