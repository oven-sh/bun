// A `--define` whose value is a dotted path reads its first name where the defined name is written: a `const` of the file, a parameter, and the `module` of a CommonJS file.
// Flags: --define ROOT=holder.value --define FLOOR=Math.floor --define OWN=module.exports
const holder = { value: "the binding of the file" };
function round(Math) {
  return FLOOR(2.5);
}
console.log(ROOT, round({ floor: () => "the parameter" }), OWN === exports);
