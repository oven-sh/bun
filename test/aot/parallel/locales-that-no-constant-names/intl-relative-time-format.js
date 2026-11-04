// Intl.RelativeTimeFormat.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
console.log(new Intl.RelativeTimeFormat((process.argv[2] ?? "de-DE")).format(-2, "day"));
