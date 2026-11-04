// Flags: --explain=trim
// Build prints: 1 x aot: trim: the compiler can see every API this program uses
Promise.resolve(1).then(console.log);
