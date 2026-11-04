// The locale comes out of the arguments of the run, so --trim has to keep every language.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
console.log((1234.5).toLocaleString(process.argv[2] ?? "de-DE"));
