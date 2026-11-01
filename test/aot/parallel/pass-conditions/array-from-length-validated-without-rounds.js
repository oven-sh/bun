// Flags: --aot-validate --aot-limit=MaxOptimizationRounds:0
// Array.from({ length }, mapper) calls a function of the compiler's own, which has no object. What names it stays in the program where no round of the optimizer runs.
const started = Array.from({ length: 20 }, () => 0);
console.log(started.length, started[19]);
