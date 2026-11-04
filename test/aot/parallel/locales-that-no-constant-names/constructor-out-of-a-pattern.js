// The constructor is taken out of Intl by a pattern.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
const { NumberFormat } = Intl;
console.log(new NumberFormat((process.argv[2] ?? "de-DE")).format(1234.5));
