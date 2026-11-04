// The name of the method is made when the program runs.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
console.log((1234.5)["toLocale" + "String".slice(0)]((process.argv[2] ?? "de-DE")));
