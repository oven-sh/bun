// `typeof` of a member whose `--define` value is one name that nothing declares is "undefined" where the name can only be a global. Beside a direct `eval` the name is read as any other expression reads it, and the read throws unless the evaluated text declares the name. Plain Bun throws in the first function too. Plain Bun prints another output.
// Flags: --define process.env.ALIAS=absent
function attempt(read) {
  try {
    return read();
  } catch (error) {
    return error.constructor.name;
  }
}
function alone() {
  return attempt(() => typeof process.env.ALIAS);
}
function besideEval(text) {
  eval(text);
  return attempt(() => typeof process.env.ALIAS);
}
console.log(alone(), besideEval(""), besideEval("var absent = 1"));
/* Output:
undefined ReferenceError number
*/
