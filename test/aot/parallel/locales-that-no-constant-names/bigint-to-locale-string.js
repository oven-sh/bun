// toLocaleString of a BigInt.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
console.log(1234567n.toLocaleString((process.argv[2] ?? "de-DE")));
