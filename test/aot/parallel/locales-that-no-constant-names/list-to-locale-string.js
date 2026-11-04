// toLocaleString of a list hands the locale on to each element.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
console.log([1234.5, 0.5].toLocaleString((process.argv[2] ?? "de-DE")));
