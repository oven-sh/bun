// The file that a program starts with has no parent: a store, an update and `delete` through a defined name whose `--define` value is a path below `module.parent` throw a TypeError there.
// Flags: --define MEMBER=module.parent.member --define process.env.REMOVED=module.parent.removed
function attempt(action) {
  try {
    return action();
  } catch (error) {
    return error.constructor.name;
  }
}
console.log(
  attempt(() => (MEMBER = 1)),
  attempt(() => MEMBER++),
  attempt(() => delete process.env.REMOVED),
);
