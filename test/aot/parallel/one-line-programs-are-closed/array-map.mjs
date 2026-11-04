// Flags: --explain=trim
// Build prints: 1 x aot: trim: the compiler can see every API this program uses
console.log([1, 2].map(x => x + 1).join());
