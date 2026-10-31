// A `--define` of `process.env.ALIAS` whose value is a dotted path reads a member of the `const` of the file, and of the parameter of the same name inside the function.
// Flags: --define process.env.ALIAS=holder.member
const holder = { member: "the const" };
function f(holder: any) {
  return process.env.ALIAS;
}
console.log(process.env.ALIAS, f({ member: "the parameter" }));
export {};
