// A `const` at the top of a module that nothing reads takes `typeof` of a name whose `--define` value is a path. A path below a `const` of the file is read there, and the getter at its end runs. A path of globals is not read, though `typeof` of that path written there reads it. Plain Bun reads both paths. Plain Bun prints another output.
// Flags: --define BOUND=holder.value --define FREE=shared.value
const holder = {
  get value() {
    console.log("the getter of the const ran");
    return 1;
  },
};
globalThis.shared = {
  get value() {
    console.log("the getter of the global ran");
    return 1;
  },
};
const first = typeof BOUND;
const second = typeof FREE;
console.log("end");
/* Output:
the getter of the const ran
end
*/
