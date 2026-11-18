// The method is read off what Object.getPrototypeOf answers.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
console.log(Object.getPrototypeOf(1).toLocaleString.call(1234.5, (process.argv[2] ?? "de-DE")));
