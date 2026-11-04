// The locale comes out of a text that is parsed when the program runs.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
const settings = JSON.parse(process.argv[2] ?? `{"locale":"de-DE"}`);
console.log((1234.5).toLocaleString(settings.locale));
