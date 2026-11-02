// A `const` at the top of a module that nothing reads takes a name whose `--define` value is a path, behind a test that `typeof` of the name is not "undefined": as the right side of `&&` and as a branch of `?:`. A path below a `const` of the file is read by the `typeof` and behind it, and the getter at its end runs both times. A path of globals is not read, though the same path written there is read by both. Plain Bun reads both paths. Plain Bun prints another output.
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
const first = typeof BOUND !== "undefined" && BOUND;
const second = typeof FREE !== "undefined" && FREE;
const third = typeof BOUND === "undefined" ? 0 : BOUND;
const fourth = typeof FREE === "undefined" ? 0 : FREE;
console.log("end");
/* Output:
the getter of the const ran
the getter of the const ran
the getter of the const ran
the getter of the const ran
end
*/
