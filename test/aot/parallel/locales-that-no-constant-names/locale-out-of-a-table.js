// The locale is picked out of a table under a key that the run brings.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
const table = { first: "ja-JP", second: "de-DE", third: "ar-EG" };
console.log((1234.5).toLocaleString(table[(process.argv[2] ?? "second")]));
