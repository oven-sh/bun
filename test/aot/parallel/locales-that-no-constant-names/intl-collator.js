// Intl.Collator.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
console.log(["z", "ä", "a"].sort(new Intl.Collator((process.argv[2] ?? "sv-SE")).compare).join());
