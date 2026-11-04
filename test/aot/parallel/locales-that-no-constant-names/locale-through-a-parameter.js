// The locale goes through a parameter to where it is used.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
function show(number, locale) { return number.toLocaleString(locale); }
console.log(show(1234.5, (process.argv[2] ?? "de-DE")));
