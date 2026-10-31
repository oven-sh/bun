// Flags: --aot-heat=everything-is-hot --aot-check=verify-each-stage
// Alone: what flow can say of the layout of the plain function goes by what else the program holds. Small changes to these files make the fault hide: this is what a generator found, cut down, and it reaches no push at run time.
// Under the check the compiler stopped: InvalidBuiltinCall at the push. Beside other.ts, whose code nobody sees, OtherA2 may make objects of its own, which are no arrays; without that file nothing makes any. The call stands behind the test that the object is a pristine Array.
const programs = {
  0: () => import("./list.js"),
  2: () => import("./other.ts"),
};
await programs[process.argv[2] ?? 0]();