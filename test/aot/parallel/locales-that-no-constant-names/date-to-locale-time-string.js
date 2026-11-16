// toLocaleTimeString.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
console.log(new Date(0).toLocaleTimeString((process.argv[2] ?? "ja-JP"), { timeZone: "UTC", timeStyle: "full" }));
