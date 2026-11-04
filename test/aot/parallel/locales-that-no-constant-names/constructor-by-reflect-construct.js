// The constructor is constructed by Reflect.construct.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
console.log(Reflect.construct(Intl.NumberFormat, [(process.argv[2] ?? "de-DE")]).format(1234.5));
