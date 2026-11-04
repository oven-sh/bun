// Flags: --explain=trim
// Build prints: 0 x aot: trim: the compiler can see every API this program uses
console.log(eval(process.argv[9] ?? "1"));
