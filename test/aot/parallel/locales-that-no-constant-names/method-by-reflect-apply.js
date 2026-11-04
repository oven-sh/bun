// The method is called by Reflect.apply.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
console.log(Reflect.apply(Number.prototype.toLocaleString, 1234.5, [(process.argv[2] ?? "de-DE")]));
