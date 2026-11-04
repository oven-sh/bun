// Intl.ListFormat.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
console.log(new Intl.ListFormat((process.argv[2] ?? "de-DE")).format(["a", "b", "c"]));
