// Two graphs are imported one after the other. In each, back.cjs lies two levels below the root and requires the root, and another branch ends in a module that imports the names of the entry point:
// one level below the root in the first graph, two levels in the second. In both, require() returns the root. Plain Bun prints another output.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
console.log("main begins");
exports.early = 1;
setTimeout(async () => {
  console.log("near has", Object.keys(await import("./near/a.mjs")).join());
  console.log("far has", Object.keys(await import("./far/a.mjs")).join());
}, 1);
/* Output:
main begins
near back begins
near b2
near b
near c sees default,early
near a
near back has value
near back ends
near has value
far back begins
far b2
far b
far c2 sees default,early
far c
far a
far back has value
far back ends
far has value
*/
