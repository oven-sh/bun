// Flags: --explain=trim
// Build prints: 1 x aot: trim: the compiler can see every API this program uses
const t = setInterval(() => { console.log(1); clearInterval(t); }, 1);
