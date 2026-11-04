// Intl.PluralRules.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
console.log(new Intl.PluralRules((process.argv[2] ?? "ar-EG")).select(2));
