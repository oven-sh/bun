// toLocaleLowerCase.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
console.log("I".toLocaleLowerCase((process.argv[2] ?? "tr-TR")));
