// No locale is passed, so the system's applies: every language stays.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
console.log(typeof (1234.5).toLocaleString());
