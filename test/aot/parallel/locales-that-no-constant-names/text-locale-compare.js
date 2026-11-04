// localeCompare.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
console.log("ä".localeCompare("z", (process.argv[2] ?? "sv-SE")), "ä".localeCompare("z", "de"));
