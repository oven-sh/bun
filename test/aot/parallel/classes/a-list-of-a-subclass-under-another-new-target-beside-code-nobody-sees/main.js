// Flags: --aot-heat=everything-is-hot --aot-check=verify-each-stage
// Alone: whether OtherA2 counts as a function that makes objects of its own goes by what else the program holds. Small changes to these files make the fault hide: this is what a generator found, cut down, and it reaches no push at run time.
// Under the check the compiler stopped at `a.length`: InvalidBuiltinCall. The test that `a` is an Array was taken for passed by every object made for OtherA2, and `new OtherA2()`, which the code that nobody sees in other.ts may run, makes no array.
const programs = {
  0: () => import("./list.js"),
  2: () => import("./other.ts"),
};
await programs[process.argv[2] ?? 0]();