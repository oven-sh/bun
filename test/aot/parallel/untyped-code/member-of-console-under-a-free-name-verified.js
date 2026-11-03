// A member of console is read under a name that nothing declares, so the code that prints values is compiled for whatever may be asked of it. No round of optimization runs, and every pass is verified.
// Flags: --aot-limit=MaxOptimizationRounds:0 --aot-check=verify-each-pass
try {
  console[nobodyDeclaresThis];
} catch (error) {
  console.log(error.name);
}
console.log({ a: [1, "two", null], b: new Map([[1, { c: 2 }]]) });
