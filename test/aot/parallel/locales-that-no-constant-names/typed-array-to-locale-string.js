// toLocaleString of a typed array.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
console.log(new Float64Array([1234.5]).toLocaleString((process.argv[2] ?? "de-DE")));
