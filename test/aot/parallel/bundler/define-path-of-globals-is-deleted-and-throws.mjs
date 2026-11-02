// `delete` of a member whose `--define` value is a path throws in strict code where the last name of the path cannot be removed. The frame has the place of the member where the first name of the path is a `const` of the file, and the place of `delete` where it is a global. Plain Bun has the end of the member for both. Plain Bun prints another output.
// Flags: --define process.env.BOUND=holder.value --define process.env.FREE=shared.value
const holder = Object.freeze({ value: 1 });
globalThis.shared = Object.freeze({ value: 1 });
function place(run) {
  try {
    run();
  } catch (error) {
    return error.message + " " + /:(\d+:\d+)\)?$/.exec(error.stack.split("\n")[1])[1];
  }
}
console.log(place(() => delete process.env.BOUND));
console.log(place(() => delete process.env.FREE));
/* Output:
Unable to delete property. 12:32
Unable to delete property. 13:25
*/
