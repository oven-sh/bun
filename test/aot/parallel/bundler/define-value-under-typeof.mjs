// `typeof` of a name with a `--define` value asks for the binding that the value names: it throws while a `let` or a `const` of that name is not yet declared, and it reads the path below a binding as any other read does.
// Flags: --define NAME=target --define ROOT=holder.value --define KIND=Kind --define MISSING=missing
function attempt(read) {
  try {
    return read();
  } catch (error) {
    return error.constructor.name;
  }
}
console.log(
  attempt(() => typeof NAME),
  attempt(() => typeof ROOT),
  attempt(() => typeof KIND),
  typeof MISSING,
);
let target = 1;
const holder = { value: "text" };
class Kind {}
function reads(target, holder) {
  return [typeof NAME, typeof ROOT].join();
}
console.log(typeof NAME, typeof ROOT, typeof KIND, typeof MISSING, reads(undefined, { value: null }));
