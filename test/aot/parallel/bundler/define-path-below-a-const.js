// A `--define` whose value is a dotted path reads a member of the `const` of the file that has its first name, not of the global of that name.
// Flags: --define ROOT=holder.value
const holder = { value: "the binding of the file" };
globalThis.holder = { value: "the global" };
console.log(ROOT, holder.value.length);
