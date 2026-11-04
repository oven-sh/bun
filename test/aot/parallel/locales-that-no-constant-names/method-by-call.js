// The method is named on the prototype object and called with call.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
console.log(Number.prototype.toLocaleString.call(1234.5, (process.argv[2] ?? "de-DE")));
