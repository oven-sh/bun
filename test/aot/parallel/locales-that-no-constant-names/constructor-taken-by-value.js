// The constructor is held in a variable.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
const Format = Intl.NumberFormat;
console.log(new Format((process.argv[2] ?? "de-DE")).format(1234.5));
