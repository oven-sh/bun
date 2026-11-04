// The receiver is a number or a date.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
const value = (process.argv[2] ?? "de-DE").length > 2 ? 1234.5 : new Date(0);
console.log(value.toLocaleString((process.argv[2] ?? "de-DE")));
