// Intl.NumberFormat.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
console.log(new Intl.NumberFormat((process.argv[2] ?? "ar-EG")).format(1234.5));
