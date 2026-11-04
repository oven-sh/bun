// The method of a formatter made with the locale is handed to map.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
console.log([1234.5].map(new Intl.NumberFormat((process.argv[2] ?? "de-DE")).format).join());
