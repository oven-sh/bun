// The locale comes out of the environment of the run, so --trim has to keep every language.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
// Env: LOCALE_OF_TEST=de-DE
console.log((1234.5).toLocaleString(process.env.LOCALE_OF_TEST));
