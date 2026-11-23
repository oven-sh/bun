// Intl.NumberFormat called like a function.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
console.log(Intl.NumberFormat((process.argv[2] ?? "de-DE")).format(1234.5));
