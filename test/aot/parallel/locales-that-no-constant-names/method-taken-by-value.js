// The method is held in a variable and called with call.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
const format = Number.prototype.toLocaleString;
console.log(format.call(1234.5, (process.argv[2] ?? "de-DE")));
