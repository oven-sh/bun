// Intl.DateTimeFormat.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
console.log(new Intl.DateTimeFormat((process.argv[2] ?? "ja-JP"), { timeZone: "UTC", dateStyle: "long" }).format(new Date(0)));
