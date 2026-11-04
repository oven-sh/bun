// Intl.DisplayNames.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
console.log(new Intl.DisplayNames((process.argv[2] ?? "de-DE"), { type: "region" }).of("US"));
