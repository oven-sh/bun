// The method is bound and called later.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
console.log(Number.prototype.toLocaleString.bind(1234.5)((process.argv[2] ?? "de-DE")));
