// toLocaleString of a date.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
console.log(new Date(0).toLocaleString((process.argv[2] ?? "de-DE"), { timeZone: "UTC" }));
