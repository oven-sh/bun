// The method is called with apply.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
console.log(Number.prototype.toLocaleString.apply(1234.5, [(process.argv[2] ?? "de-DE")]));
