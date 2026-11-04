// toLocaleUpperCase.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
console.log("i".toLocaleUpperCase((process.argv[2] ?? "tr-TR")));
